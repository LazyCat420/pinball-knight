/**
 * 🔮 MULTI-BALL — the pinball classic, as a power-up.
 *
 * Two ECHO KNIGHTS peel off the player and chase the path you just took: each
 * samples the player's recent position TRAIL at its own lag and sits a little
 * off to one side. A rigid fixed offset reads as furniture glued to the knight
 * — a delayed trail reads as a ball that split, which is the whole point.
 *
 * They deal contact damage through `damageZombie` (the one funnel), at half a
 * ram and with a per-enemy cooldown so an echo parked on a zombie can't delete
 * it in a single frame.
 *
 * Everything the feature owns lives here — spawn, per-frame update, teardown —
 * so core.ts only has to tick it and dispose.ts only has to drop it.
 */
import * as THREE from "three";
import { state, activeWeapon, type Zombie } from "../state";
import { createActorSprite, type ActorSprite, type SpriteSheet } from "../engine/render/sprite";
import { getKnightSheet } from "../render/knight-sheets";
import { lookFromGear } from "../render/knight-look";
import { Animator, facingFromVelocity, isRideClip, type Facing } from "../engine/render/animator";
import type { ClipName } from "../engine/render/paint-types";
import { worldDirToScreen } from "../engine/camera";
import { syncActorMesh, damageZombie, playerDamage } from "./combat";
import { WEAPONS, POTIONS } from "../items";
import {
  MULTIBALL_COUNT,
  MULTIBALL_TRAIL_SECONDS,
  MULTIBALL_LAGS,
  MULTIBALL_SIDE_OFFSET,
  MULTIBALL_HEADING_STEP,
  MULTIBALL_FOLLOW_RATE,
  MULTIBALL_RAM_MULT,
  MULTIBALL_RAM_COOLDOWN,
  MULTIBALL_OPACITY,
  BALL_RAM_KNOCKBACK,
  PLAYER_R,
  ZOMBIE_R,
} from "../constants";

/** One sample of where the knight was, and when. */
export interface TrailPoint {
  x: number;
  z: number;
  /** Seconds on the buff-local clock (monotonic while the buff runs). */
  t: number;
}

interface Echo {
  sprite: ActorSprite;
  anim: Animator;
  x: number;
  z: number;
  facing: Facing;
  /** Seconds this echo runs behind the live knight. */
  lag: number;
  /** Signed sideways offset off the sampled path, world units. */
  side: number;
  /** Per-enemy ram cooldowns — an echo may not re-hit the same body until 0. */
  hitCd: Map<Zombie, number>;
}

// ── Module-owned live state (nothing leaks into state.ts) ──
let echoes: Echo[] = [];
let trail: TrailPoint[] = [];
let clock = 0;

// ══════════════════════════════════════════════════════════════════
// Pure maths — unit-tested directly, no three/DOM involved.
// ══════════════════════════════════════════════════════════════════

/**
 * Append a sample and drop everything older than `maxAge`. One point older than
 * the window is DELIBERATELY kept: the deepest echo interpolates across it, and
 * pruning it would snap that echo forward at the window edge.
 */
export function pushTrail(points: TrailPoint[], x: number, z: number, t: number, maxAge = MULTIBALL_TRAIL_SECONDS): TrailPoint[] {
  points.push({ x, z, t });
  const cutoff = t - maxAge;
  while (points.length > 2 && points[1].t <= cutoff) points.shift();
  return points;
}

/**
 * Where the knight was at time `t`, linearly interpolated between samples.
 * Clamps to the ends (before the trail starts you get its oldest point, which
 * is what makes the echoes stream OUT of the player on spawn instead of
 * popping into place). Null only for an empty trail.
 */
export function sampleTrail(points: TrailPoint[], t: number): { x: number; z: number } | null {
  if (points.length === 0) return null;
  const first = points[0];
  const last = points[points.length - 1];
  if (t <= first.t) return { x: first.x, z: first.z };
  if (t >= last.t) return { x: last.x, z: last.z };
  for (let i = points.length - 1; i > 0; i--) {
    const b = points[i];
    const a = points[i - 1];
    if (t >= a.t) {
      const span = b.t - a.t;
      const f = span > 0 ? (t - a.t) / span : 0;
      return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
    }
  }
  return { x: first.x, z: first.z };
}

/**
 * The point an echo wants to be at: the trail sampled at `now - lag`, pushed
 * `side` units perpendicular to the direction the knight was travelling there.
 * A stationary knight has no heading, so the offset collapses to zero and the
 * echoes simply stack on the path rather than snapping to an arbitrary axis.
 */
export function echoTarget(
  points: TrailPoint[],
  now: number,
  lag: number,
  side: number,
  headingStep = MULTIBALL_HEADING_STEP,
): { x: number; z: number } | null {
  const at = sampleTrail(points, now - lag);
  if (!at) return null;
  const before = sampleTrail(points, now - lag - headingStep);
  if (!before) return at;
  const dx = at.x - before.x;
  const dz = at.z - before.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-4) return at;
  // Perpendicular of a unit heading, times the signed offset.
  return { x: at.x + (-dz / len) * side, z: at.z + (dx / len) * side };
}

/** Frame-rate independent exponential ease toward a target. */
export function followStep(current: number, target: number, dt: number, rate = MULTIBALL_FOLLOW_RATE): number {
  const f = 1 - Math.exp(-rate * dt);
  return current + (target - current) * f;
}

/**
 * What an echo plays this frame, given the knight's live pose and whether the
 * echo itself is moving.
 *
 * THE POINT OF THE POWER-UP IS THREE BALLS. An echo whose clip is derived from
 * its own velocity plays a WALK CYCLE while the knight is a hurtling marble —
 * two knights jogging after a ball, which reads as three different things on
 * screen instead of one thing three times. So whenever he is in a ride pose
 * (ball, steel ball, any marble body, the tumble, a ricochet form) the echo
 * mirrors HIS clip at HIS spin rate; on his feet, it falls back to its own
 * motion, because an echo trailing a standing knight genuinely is walking.
 *
 * The rate is copied rather than recomputed for the same reason the clip is:
 * the spin scales with momentum, and a second copy of that formula here is a
 * second thing to keep in step (see `Animator.getRate`).
 */
export function echoPose(playerClip: ClipName, playerRate: number, moving: boolean): { clip: ClipName; rate: number } {
  if (isRideClip(playerClip)) return { clip: playerClip, rate: playerRate };
  return { clip: moving ? "walk" : "idle", rate: 1 };
}

/** Has this echo's cooldown on that enemy expired (or never started)? */
export function canRam<K>(cd: Map<K, number>, key: K): boolean {
  return (cd.get(key) ?? 0) <= 0;
}

/** Bleed every cooldown down by dt, dropping entries that reach zero. */
export function tickRamCooldowns<K>(cd: Map<K, number>, dt: number): Map<K, number> {
  for (const [key, left] of cd) {
    const next = left - dt;
    if (next <= 0) cd.delete(key);
    else cd.set(key, next);
  }
  return cd;
}

// ══════════════════════════════════════════════════════════════════
// Live rig
// ══════════════════════════════════════════════════════════════════

/**
 * The knight atlas for the hand currently held, reusing (and topping up) the
 * shared `state.playerSheets` cache — so the echoes never own a texture, and
 * disposeAll's existing sheet sweep already covers them.
 */
function knightSheet(): SpriteSheet {
  // Echoes mirror the player exactly — same weapon, same worn gear.
  return getKnightSheet(activeWeapon().id, lookFromGear(state.gear), "dungeon");
}

/** True while the echoes are out. */
export function multiBallActive(): boolean {
  return echoes.length > 0;
}

/**
 * Live echo POSES — for debug readouts (`__dungeonEchoes()`).
 *
 * The clip is in here because "are the echoes rolling?" was a question only a
 * screenshot could answer, and a screenshot of two ghosts one behind the other
 * is exactly the picture that hid the walk cycle for a whole release.
 */
export function multiBallPositions(): Array<{ x: number; z: number; clip: string; facing: Facing }> {
  return echoes.map((e) => ({ x: e.x, z: e.z, clip: e.anim.getClip(), facing: e.facing }));
}

/**
 * Split the knight. Idempotent: calling it while the echoes are already out
 * (re-drinking the potion) just refreshes the trail rather than doubling up.
 */
export function spawnMultiBall(): void {
  const p = state.player;
  if (!p || !state.scene) return;
  clock = 0;
  trail = [{ x: p.x, z: p.z, t: 0 }];
  if (echoes.length) return;

  const sheet = knightSheet();
  const tint = POTIONS.multiball.color;
  for (let i = 0; i < MULTIBALL_COUNT; i++) {
    const sprite = createActorSprite(sheet, false);
    // Ghost treatment: translucent, no hard cutout, drawn after the opaque
    // actors and never writing depth — an echo, not a second knight.
    const mat = sprite.mesh.material as THREE.MeshBasicMaterial;
    mat.transparent = true;
    mat.opacity = MULTIBALL_OPACITY;
    mat.alphaTest = 0.02;
    mat.depthWrite = false;
    sprite.mesh.renderOrder = 11;
    sprite.setTint(tint);
    sprite.setBlobVisible(false); // a ghost casts no contact shadow
    state.scene.add(sprite.mesh);

    const anim = new Animator(sprite);
    anim.setFacing(p.facing);
    // Drink it mid-ride and the echoes peel off ALREADY ROLLING — the first
    // frame they are ever painted is the one they would settle into anyway.
    const pose = echoPose(p.anim.getClip(), p.anim.getRate(), false);
    anim.setRate(pose.rate);
    anim.play(pose.clip);
    const echo: Echo = {
      sprite,
      anim,
      x: p.x,
      z: p.z,
      facing: p.facing,
      lag: MULTIBALL_LAGS[i] ?? MULTIBALL_LAGS[MULTIBALL_LAGS.length - 1],
      // Alternate sides so the pair reads as a spread, not a queue.
      side: (i % 2 === 0 ? 1 : -1) * MULTIBALL_SIDE_OFFSET,
      hitCd: new Map(),
    };
    syncActorMesh(echo);
    echoes.push(echo);
  }
}

/**
 * Per-frame: tick the buff, stream the trail, walk the echoes along it and
 * resolve their contact rams. Owns the `multiBallT` countdown itself so core's
 * generic buff loop stays untouched.
 */
export function updateMultiBall(dt: number): void {
  const p = state.player;
  if (!p) return;

  if (p.multiBallT > 0) {
    const before = p.multiBallT;
    p.multiBallT = Math.max(0, before - dt);
    if (Math.ceil(p.multiBallT) !== Math.ceil(before) || p.multiBallT === 0) state.hudDirty = true;
  }
  if (p.multiBallT <= 0) {
    if (echoes.length) disposeMultiBall();
    return;
  }
  if (!echoes.length) spawnMultiBall();
  if (!echoes.length) return;

  clock += dt;
  pushTrail(trail, p.x, p.z, clock);

  const w = WEAPONS[activeWeapon().id];
  const dmg = playerDamage(Math.max(2, w.damage * 1.5) * MULTIBALL_RAM_MULT);
  const reach = PLAYER_R + ZOMBIE_R + 0.15;
  const reachSq = reach * reach;

  // The knight's live pose, read once — every echo wears the same one.
  const knightClip = p.anim.getClip();
  const knightRate = p.anim.getRate();

  for (const e of echoes) {
    const target = echoTarget(trail, clock, e.lag, e.side);
    let moving = false;
    if (target) {
      const px = e.x;
      const pz = e.z;
      e.x = followStep(e.x, target.x, dt);
      e.z = followStep(e.z, target.z, dt);
      const s = worldDirToScreen(e.x - px, e.z - pz);
      moving = Math.hypot(e.x - px, e.z - pz) > 1e-4;
      e.facing = facingFromVelocity(s.x, s.z, e.facing);
      e.anim.setFacing(e.facing);
    }
    // Outside the `target` guard on purpose: a frame with no trail sample still
    // has to follow the knight into (and out of) the ball, or an echo that was
    // walking when the ride started stays walking until it happens to move.
    const pose = echoPose(knightClip, knightRate, moving);
    e.anim.setRate(pose.rate);
    e.anim.play(pose.clip);
    e.anim.update(dt);
    syncActorMesh(e);

    tickRamCooldowns(e.hitCd, dt);
    for (const z of state.zombies) {
      if (z.mode === "dead") continue;
      const dx = z.x - e.x;
      const dz = z.z - e.z;
      if (dx * dx + dz * dz > reachSq) continue;
      if (!canRam(e.hitCd, z)) continue;
      const inv = Math.hypot(dx, dz) || 1;
      // Same tool as the knight's own ram, so the "bounce-immune" exception
      // cannot be laundered by sending an echo-knight instead.
      damageZombie(z, dmg, dx / inv, dz / inv, BALL_RAM_KNOCKBACK * 0.6, false, "bounce");
      e.hitCd.set(z, MULTIBALL_RAM_COOLDOWN);
      state.vfx?.sparks(e.x, 0.55, e.z, dx / inv, dz / inv, 4);
    }
  }
}

/**
 * Drop the echoes: pull the meshes out of the scene and release each sprite's
 * geometry, material and cloned texture. Safe to call at any time — on expiry,
 * on level change and on teardown — and leaves nothing to leak across a run.
 */
export function disposeMultiBall(): void {
  for (const e of echoes) {
    state.scene?.remove(e.sprite.mesh);
    e.sprite.dispose();
    e.hitCd.clear();
  }
  echoes = [];
  trail = [];
  clock = 0;
}
