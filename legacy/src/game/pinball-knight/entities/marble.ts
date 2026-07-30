/**
 * MARBLE MATERIALS — the "what is the ball made of" axis.
 *
 * A material is NOT a potion: it modifies the pinball ride's physics at the same
 * choke points that already branch on springT/turboT/oilT, plus it fires an
 * emitter on every fast wall bounce and a bigger one from the pounce slam. Held
 * one at a time; a fresh pickup opens a short FUSION window during which the
 * previous material co-fires before it expires (the one novel stacking rule).
 *
 * This module owns:
 *   • metadata (label/icon/tint) for HUD + pickups + debug,
 *   • pure physics helpers the ride reads (restitution/friction/knockback/…),
 *   • applyMaterial / updateMaterial (timers + fusion),
 *   • emitMaterialOnBounce / materialSlam (the shard/slick/shockwave emitters).
 *
 * Everything downstream reuses existing engines: spawnShardBurst (golem shards),
 * spawnFloorFx (new floor scars), damageZombie + the pounce dust-ring for the
 * shockwave, and vfx.ghost for the aura tint.
 */
import { state, type MarbleMaterial, type EnemyKind } from "../state";
import {
  MATERIAL_DURATION,
  MATERIAL_FUSION_TIME,
  MATERIAL_EMIT_SPEED,
  MATERIAL_EMIT_COOLDOWN,
  DIAMOND_RESTITUTION,
  DIAMOND_WALL_BREAK_SPEED,
  DIAMOND_SECRET_BREAK_SPEED,
  DIAMOND_BOUNCE_SHARDS,
  DIAMOND_BOUNCE_FAN,
  DIAMOND_BOUNCE_DMG,
  DIAMOND_SHARD_SPEED,
  DIAMOND_SLAM_SHARDS,
  DIAMOND_SLAM_SPEED,
  DIAMOND_SLAM_DMG,
  WATER_RESTITUTION,
  WATER_FRICTION_MULT,
  WATER_STEER_MULT,
  WATER_RAM_KNOCKBACK,
  WATER_SLICK_RADIUS,
  WATER_SLICK_LIFE,
  WATER_SLAM_SLICKS,
  WATER_SLAM_SPEED_KICK,
  STONE_RAM_KNOCKBACK,
  STONE_RAM_DAMAGE_MULT,
  STONE_WALL_BREAK_SPEED_COST,
  STEEL_WALL_BREAK_SPEED,
  STEEL_SECRET_BREAK_SPEED,
  STEEL_RAM_KNOCKBACK,
  STEEL_FRICTION_MULT,
  STEEL_STEER_MULT,
  STEEL_RAM_DAMAGE_MULT,
  STEEL_WALL_BREAK_SPEED_COST,
  WALL_BREAK_SPEED_COST,
  STONE_FRICTION_MULT,
  STONE_MAX_SPEED,
  STONE_BUMPER_KICK_MULT,
  STONE_CORNER_ADD_MULT,
  STONE_SHOCK_RADIUS,
  STONE_SHOCK_DMG,
  STONE_SHOCK_GOLEM_MULT,
  STONE_SLAM_RADIUS,
  STONE_SLAM_BASE_DMG,
  STONE_SLAM_DMG_PER_SPEED,
  SECRET_BREAK_SPEED,
  WALL_BREAK_SPEED,
  PINBALL_MAX_SPEED,
  BALL_RAM_KNOCKBACK,
  PLAYER_R,
  ZOMBIE_R,
  WATER_STEAM_LAUNCH,
  WATER_STEAM_RADIUS,
  WATER_STEAM_DMG,
  STONE_MAGSTRIP_CAP,
  DIAMOND_DISCHARGE_RADIUS,
  DIAMOND_DISCHARGE_DMG,
  STORM_LANE_PULL_MULT,
  STORM_STEER_MULT,
  STORM_BOUNCE_ARC_DMG,
  STORM_BOUNCE_ARC_LEN,
  STORM_BOUNCE_ARC_HALF,
  STORM_CLAP_RADIUS,
  STORM_CLAP_DMG,
  STORM_CLAP_STUN,
  STORM_WET_DMG,
  SHADOW_PLAYER_R,
  SHADOW_RESTITUTION,
  SHADOW_BUMPER_SCATTER_MULT,
  SHADOW_LURE_RADIUS,
  SHADOW_LURE_TIME,
  SHADOW_IMPLODE_RADIUS,
  SHADOW_IMPLODE_PULL,
  SHADOW_IMPLODE_DMG,
  LAVA_BUMPER_MULT,
  LAVA_SLAM_GLOBS,
  LAVA_SLAM_FIRE_RADIUS,
  LAVA_SLAM_FIRE_LIFE,
  FIRE_PUDDLE_RADIUS,
  FIRE_PUDDLE_LIFE,
  WATER_SQUASH,
  LAVA_SQUASH,
  SQUASH_RECOVER,
  SQUASH_DEPTH,
  SQUASH_MIN_SPEED,
  STONE_WALL_BREAK_SPEED,
  STONE_SECRET_BREAK_SPEED,
  DIAMOND_CUT_SPEED,
  DIAMOND_CUT_DMG_MULT,
  DIAMOND_CUT_COOLDOWN,
  DIAMOND_CUT_KNOCKBACK,
  SHADOW_SLAYER_MULT,
  SHADOW_LIFESTEAL,
  SHADOW_LIFESTEAL_CD,
  SHADOW_PHASE_GRACE,
  BALL_RAM_COOLDOWN,
} from "../constants";
import { worldDirToScreen } from "../engine/camera";
import { playerMaxHp } from "../skill-runtime";
import { PALETTE_HEX } from "../render/palette";
import type { ClipName } from "../engine/render/paint-types";
import { moveCircle, type MoveResult } from "../engine/collision";
import { isWalkable, tileCenter, worldToTile, type Grid } from "../engine/grid";
import { showToast } from "../ui";
import { spawnShardBurst } from "./projectiles";
import { spawnFloorFx } from "./floor-fx";
import { lavaMeltWall } from "./wall-erosion";
import { enterRicochetForm } from "./ricochet-form";
import { damageZombie } from "./combat";
import { sfxFreeze, sfxSpring, sfxHeavy, sfxBumper, sfxSpin, sfxFlame } from "../sfx";

export interface MaterialMeta {
  label: string;
  icon: string;
  /** Pickup-sprite / burst colour. */
  tint: number;
  /** Afterimage-trail tint — deliberately DISTINCT from the buff tells
   *  (diamond can't ride 0x6fd0e8: that already means HASTE on the knight). */
  trail: number;
  /** The transformation sting (also fired on fusion). */
  sfx: () => void;
}

export const MATERIALS: Record<MarbleMaterial, MaterialMeta> = {
  diamond: { label: "Diamond", icon: "💎", tint: PALETTE_HEX[31], trail: 0xd8f6ff, sfx: sfxFreeze },
  water: { label: "Water", icon: "💧", tint: PALETTE_HEX[30], trail: 0x3f9fd8, sfx: sfxSpring },
  stone: { label: "Stone", icon: "🪨", tint: PALETTE_HEX[4], trail: 0x9aa4b4, sfx: sfxHeavy },
  storm: { label: "Storm", icon: "⚡", tint: 0xf0e05a, trail: 0xfff3a0, sfx: sfxBumper },
  shadow: { label: "Shadow", icon: "🌑", tint: 0x2a1e3a, trail: 0x140a1e, sfx: sfxSpin },
  lava: { label: "Lava", icon: "🔥", tint: 0xf0a63c, trail: 0xd97b29, sfx: sfxFlame },
};

export const MATERIAL_LIST: MarbleMaterial[] = ["diamond", "water", "stone", "storm", "shadow", "lava"];

export function isMaterial(id: string): id is MarbleMaterial {
  return id === "diamond" || id === "water" || id === "stone" || id === "storm" || id === "shadow" || id === "lava";
}

/**
 * True while the 🪩 BALL FORM potion is up — "you ARE the pinball", so the ball
 * is genuinely made of steel for as long as it lasts.
 *
 * This is deliberately NOT the default for every momentum ride. An ordinary
 * overcharge roll is the knight tumbling with momentum; only the potion turns
 * him into a ball bearing, and the weight below is that potion's payoff. A
 * marble MATERIAL still overrides steel wholesale — a pickup replaces what the
 * ball is made of.
 */
function steelBall(): boolean {
  const p = state.player;
  return !!p && p.ironT > 0;
}

/** True when materials are globally enabled and a player currently has one. */
function activeMaterial(): MarbleMaterial | null {
  if (!state.dbgMaterialEnabled) return null;
  const p = state.player;
  return p && p.materialT > 0 ? p.material : null;
}

// ── Apply / update ──────────────────────────────────────────────

/** Pick up (or debug-grant) a material. A 2nd material opens a fusion window. */
export function applyMaterial(id: MarbleMaterial): void {
  const p = state.player;
  if (!p) return;
  const fusing = p.material && p.material !== id && p.materialT > 0;
  if (fusing) {
    // Fusion: the outgoing material co-fires briefly alongside the new one.
    p.fuseMaterial = p.material;
    p.fuseT = MATERIAL_FUSION_TIME;
  }
  p.material = id;
  p.materialT = MATERIAL_DURATION[id];
  // ── The TRANSFORMATION moment — the ball recrystallizes. A tinted radial
  // burst at the knight (white-hot cores bloom), a stack of quick afterimages
  // in the material's trail hue, a kick of shake, and the material's sting.
  // Fusion doubles the burst: two colours collide.
  const meta = MATERIALS[id];
  state.vfx?.burst(p.x, 0.5, p.z, meta.tint, 18, 5);
  state.vfx?.burst(p.x, 0.15, p.z, meta.trail, 10, 3);
  if (fusing && p.fuseMaterial) state.vfx?.burst(p.x, 0.5, p.z, MATERIALS[p.fuseMaterial].tint, 12, 4);
  for (let i = 0; i < 3; i++) state.vfx?.ghost(p.sprite.mesh, meta.trail, 0.4 + i * 0.12, 0.5 - i * 0.12);
  state.shakeT = Math.max(state.shakeT, 0.22);
  state.hitstopT = Math.max(state.hitstopT, 0.04);
  meta.sfx();
  state.hudDirty = true;
}

/** Tick the material + fusion timers; clear the material when it lapses. */
export function updateMaterial(dt: number): void {
  const p = state.player;
  if (!p) return;
  if (p.materialEmitT > 0) p.materialEmitT = Math.max(0, p.materialEmitT - dt);
  if (p.fuseT > 0) {
    p.fuseT = Math.max(0, p.fuseT - dt);
    if (p.fuseT === 0) p.fuseMaterial = null;
  }
  if (p.materialT > 0) {
    const before = p.materialT;
    p.materialT = Math.max(0, p.materialT - dt);
    if (Math.ceil(before) !== Math.ceil(p.materialT) || p.materialT === 0) state.hudDirty = true;
    if (p.materialT === 0) p.material = null;
  }
}

// ── Physics helpers (pure; the ride reads these) ────────────────

/** Flat/slant wall restitution override, or null to use the default. */
export function materialFlatRestitution(): number | null {
  switch (activeMaterial()) {
    case "diamond": return DIAMOND_RESTITUTION;
    case "water": return WATER_RESTITUTION;
    case "shadow": return SHADOW_RESTITUTION;
    default: return null;
  }
}

/** Effective collision radius for the ride sweep (shadow slips tight gaps). */
export function materialPlayerR(): number {
  return activeMaterial() === "shadow" ? SHADOW_PLAYER_R : PLAYER_R;
}

/** Multiplier on bumper exit-scatter (shadow's exits go unpredictable). */
export function materialBumperScatterMult(): number {
  return activeMaterial() === "shadow" ? SHADOW_BUMPER_SCATTER_MULT : 1;
}

/**
 * Effective wall-break thresholds.
 *
 * Two different reasons a ball goes through a wall, and they must not converge:
 * DIAMOND breaks masonry by being HARD, so it needs almost no speed (8/4);
 * STONE breaks it by being HEAVY, so it still has to be thrown (11/5.5). Give
 * them the same numbers and you have one material with two skins.
 */
export function materialBreakSpeeds(): { secret: number; wall: number } {
  const m = activeMaterial();
  if (m === "diamond") {
    return { secret: DIAMOND_SECRET_BREAK_SPEED, wall: DIAMOND_WALL_BREAK_SPEED };
  }
  if (m === "stone") {
    return { secret: STONE_SECRET_BREAK_SPEED, wall: STONE_WALL_BREAK_SPEED };
  }
  // Ball Form: steel bites masonry harder than a tumbling knight does.
  if (steelBall()) return { secret: STEEL_SECRET_BREAK_SPEED, wall: STEEL_WALL_BREAK_SPEED };
  return { secret: SECRET_BREAK_SPEED, wall: WALL_BREAK_SPEED };
}

/**
 * Multiplier on momentum friction (water glides, stone drags).
 *
 * STEEL is the BARE-BALL baseline only — a material pickup replaces the ball's
 * substance outright, so diamond/storm/shadow/lava keep their own neutral 1
 * rather than inheriting steel's weight on top of their own identity.
 */
export function materialFrictionMult(): number {
  const m = activeMaterial();
  switch (m) {
    case "water": return WATER_FRICTION_MULT;
    case "stone": return STONE_FRICTION_MULT;
    default: return !m && steelBall() ? STEEL_FRICTION_MULT : 1; // heavy: floor scrubs it less
  }
}

/** Multiplier on steering grip (water is slippery, storm is sharp). */
export function materialSteerMult(): number {
  const m = activeMaterial();
  switch (m) {
    case "water": return WATER_STEER_MULT;
    case "storm": return STORM_STEER_MULT;
    default: return !m && steelBall() ? STEEL_STEER_MULT : 1; // …and harder to turn
  }
}

/** Multiplier on the lane-centring pull (storm rails corridors). */
export function materialLanePull(): number {
  return activeMaterial() === "storm" ? STORM_LANE_PULL_MULT : 1;
}

/** Ram knockback for the current material (stone shoves hard, water flows). */
export function materialRamKnockback(): number {
  const m = activeMaterial();
  switch (m) {
    case "stone": return STONE_RAM_KNOCKBACK;
    case "water": return WATER_RAM_KNOCKBACK;
    // Ball Form shoves harder; everything else keeps its own tuned value.
    default: return !m && steelBall() ? STEEL_RAM_KNOCKBACK : BALL_RAM_KNOCKBACK;
  }
}

/**
 * Damage multiplier the ram applies for the ball's own mass. Steel is the
 * bare-ball baseline; Stone (the boulder pickup) hits harder still; the other
 * materials trade mass for their own effects and stay neutral.
 */
export function materialRamDamageMult(): number {
  const m = activeMaterial();
  if (m === "stone") return STONE_RAM_DAMAGE_MULT;
  return !m && steelBall() ? STEEL_RAM_DAMAGE_MULT : 1;
}

/** Momentum retained after punching through masonry. Steel barely slows. */
export function materialWallBreakCost(): number {
  const m = activeMaterial();
  if (m === "stone") return STONE_WALL_BREAK_SPEED_COST;
  return !m && steelBall() ? STEEL_WALL_BREAK_SPEED_COST : WALL_BREAK_SPEED_COST;
}

/** Extra multiplier on the corner-hit acceleration (stone corners hit harder). */
export function materialCornerAddMult(): number {
  return activeMaterial() === "stone" ? STONE_CORNER_ADD_MULT : 1;
}

/** Multiplier on bumper kick (stone ignores small forces; lava is explosive). */
export function materialBumperMult(): number {
  switch (activeMaterial()) {
    case "stone": return STONE_BUMPER_KICK_MULT;
    case "lava": return LAVA_BUMPER_MULT;
    default: return 1;
  }
}

/** Speed ceiling for the current material (stone tops out lower). */
export function materialMaxSpeed(): number {
  return activeMaterial() === "stone" ? STONE_MAX_SPEED : PINBALL_MAX_SPEED;
}

/**
 * The animation clip for the active material's BODY, or null to fall through to
 * steel / the plain knight.
 *
 * Derived from the material name rather than a seventh lookup table — the clip
 * union names them `<material>ball` precisely so this stays one line and cannot
 * fall out of step. registry-drift check F verifies the other end: that the
 * clip actually exists in the union, the animator and the atlas.
 *
 * Note this reads `activeMaterial()`, so it honours the dbgMaterialEnabled
 * toggle — turning materials off in the debug panel restores the old knight.
 */
export function materialClip(): ClipName | null {
  const m = activeMaterial();
  return m ? (`${m}ball` as ClipName) : null;
}

/**
 * How much the ball DEFORMS when it hits a wall, 0..1.
 *
 * The contrast is the point: a droplet smooshes, a diamond and a rock do not,
 * and running the same squash on all six would make every material feel like
 * jelly. Lava sits between — a crusted shell over a liquid interior gives a
 * little, but it doesn't splat.
 */
export function materialSquash(): number {
  switch (activeMaterial()) {
    case "water": return WATER_SQUASH;
    case "lava": return LAVA_SQUASH;
    default: return 0;
  }
}

/**
 * Record an impact so the ball deforms. `nx,nz` is the WORLD contact normal;
 * `speed` gates it so a gentle roll into masonry doesn't wobble.
 *
 * The normal is converted to SCREEN space here rather than at render time
 * because the impact is a moment and the camera is not: storing the world
 * normal and projecting it each frame would make a squash rotate if the view
 * ever moved mid-recovery.
 *
 * Called from the four ride bounce sites next to emitMaterialOnBounce — but
 * deliberately NOT from inside it, because that emitter is throttled and
 * speed-gated for VFX spam, and a ball that only smooshed every 0.12s would
 * visibly skip deformations during a fast rally.
 */
export function noteSquash(nx: number, nz: number, speed: number): void {
  const amp = materialSquash();
  if (amp <= 0 || speed < SQUASH_MIN_SPEED) return;
  const p = state.player;
  if (!p) return;
  const s = worldDirToScreen(nx, nz);
  const len = Math.hypot(s.x, s.z) || 1;
  p.squashHx = s.x / len;
  p.squashHy = s.z / len;
  // Scale with impact: a hard slam flattens the droplet, a graze dimples it.
  // Full amplitude by roughly twice the gate speed.
  p.squashAmp = amp * Math.min(1, speed / (SQUASH_MIN_SPEED * 2));
  p.squashT = SQUASH_RECOVER;
}

/**
 * The sprite's non-uniform scale for this frame: `[scaleX, scaleY]`.
 *
 * Compresses along the impact and bulges across it, so the ball's apparent
 * AREA stays roughly constant — a ball that only squashed would read as
 * shrinking on every hit.
 *
 * ── Why this picks a DOMINANT AXIS instead of blending the two ──
 * The sprite is a camera-facing billboard whose geometry origin is at the
 * FEET, so the only deformation available is an axis-aligned scale — rotating
 * the quad to line up with the impact would swing the ball around its feet
 * rather than squash it in place.
 *
 * The first version blended: `1 − d·|hx| + d·|hy|` per axis. That reads fine
 * until you notice this camera is a 45° isometric, which maps EVERY
 * axis-aligned world normal — i.e. every wall in the maze — to a screen vector
 * with |hx| = |hy|. The two terms then cancel exactly and the scale comes back
 * [1, 1]: the squash was invisible in the one case that occurs all the time,
 * and nothing about it threw.
 *
 * So: squash along whichever screen axis the impact leans toward, ties going
 * to x. At 45° that is off by an eighth-turn from the true contact direction,
 * which is not detectable on a radially symmetric ball — where "no
 * deformation at all" very much is.
 *
 * The recovery is a half-sine rather than a linear ramp: deformation peaks on
 * contact and eases out, where a linear decay looks mechanical.
 */
export function squashScale(): [number, number] {
  const p = state.player;
  if (!p || p.squashT <= 0) return [1, 1];
  const t = p.squashT / SQUASH_RECOVER; // 1 at impact → 0 recovered
  const d = SQUASH_DEPTH * p.squashAmp * Math.sin(t * Math.PI * 0.5);
  // EXACTLY area-preserving: the bulge is the reciprocal of the squash, not
  // `1 + d`. The naive pair multiplies out to 1 − d², so at full depth the ball
  // quietly lost ~16% of its apparent size on every impact — a squash that also
  // shrinks reads as the ball being knocked further away.
  const flat = 1 - d;
  const bulge = 1 / flat;
  return Math.abs(p.squashHx) >= Math.abs(p.squashHy) ? [flat, bulge] : [bulge, flat];
}

/** Tick the squash recovery. Cheap enough to run unconditionally. */
export function updateSquash(dt: number): void {
  const p = state.player;
  if (p && p.squashT > 0) p.squashT = Math.max(0, p.squashT - dt);
}

// ── 💎 Diamond: the CUT ─────────────────────────────────────────

/**
 * True while diamond is up and moving fast enough to CUT rather than ram.
 *
 * The distinction is not cosmetic. A ram shoves one clump and then sits on
 * BALL_RAM_COOLDOWN; a cut carries no knockback and re-arms almost instantly,
 * so a fast diamond opens a corridor straight through a crowd. That is the
 * fantasy — "cuts like a diamond through enemies" — and the cooldown, not the
 * damage number, is what delivers it.
 */
export function materialCutsThrough(): boolean {
  const p = state.player;
  return activeMaterial() === "diamond" && !!p && p.momSpeed >= DIAMOND_CUT_SPEED;
}

/** Ram damage multiplier — an edge concentrates the same mass into less area. */
export function materialRamCutMult(): number {
  return materialCutsThrough() ? DIAMOND_CUT_DMG_MULT : 1;
}

/** Knockback for this contact. A cut does not shove: it slices where it stands. */
export function materialContactKnockback(): number {
  return materialCutsThrough() ? DIAMOND_CUT_KNOCKBACK : materialRamKnockback();
}

/** Seconds before the ram can hit again — a cut re-arms almost immediately. */
export function materialRamCooldown(): number {
  return materialCutsThrough() ? DIAMOND_CUT_COOLDOWN : BALL_RAM_COOLDOWN;
}

/**
 * Diamond cannot be broken — including by the one enemy built to break it.
 *
 * The `sapper` (ANTI-MATERIAL) strips your marble on contact. Every other
 * material is fair game; diamond is the answer to it, which is what makes
 * "can't break" a mechanic rather than a line of flavour text.
 */
export function materialResistsDrain(): boolean {
  return activeMaterial() === "diamond";
}

// ── 🌑 Shadow: the slayer and the feed ──────────────────────────

/**
 * The roster shadow deletes: everything that phases through walls or blinks out
 * of a swing. Shadow becomes the counter to the enemies you cannot otherwise
 * corner — you fight them by BEING one.
 *
 * `reaper` is included deliberately even though it is normally damage-immune;
 * combat.ts gates that separately, so this multiplier only lands if the reaper's
 * own immunity is not in force.
 */
const SHADOW_PREY = new Set<EnemyKind>(["ghost", "reaper", "wisp"]);

/** Damage multiplier against `kind` — 1 for anything shadow doesn't hunt. */
export function shadowSlayerMult(kind: EnemyKind): number {
  return activeMaterial() === "shadow" && SHADOW_PREY.has(kind) ? SHADOW_SLAYER_MULT : 1;
}

/**
 * Drain a hit foe for health. Cooldowned: without it, one ram through a packed
 * corridor is a full heal, which turns shadow from a risky glass form into the
 * safest material in the game.
 */
export function shadowVampire(): void {
  if (activeMaterial() !== "shadow") return;
  const p = state.player;
  if (!p || p.vampCdT > 0) return;
  const max = playerMaxHp();
  if (p.hp >= max) return;
  p.hp = Math.min(max, p.hp + SHADOW_LIFESTEAL);
  p.vampCdT = SHADOW_LIFESTEAL_CD;
  state.hudDirty = true;
  // Violet motes pulled INTO the ball — the same inward read as the void body.
  state.vfx?.burst(p.x, 0.6, p.z, 0xb06fe8, 8, 2.5);
}

/** Tick the lifesteal cooldown. */
export function updateVampire(dt: number): void {
  const p = state.player;
  if (p && p.vampCdT > 0) p.vampCdT = Math.max(0, p.vampCdT - dt);
}

// ── 🔥 Lava: melting masonry ────────────────────────────────────

/**
 * Melt the wall this bounce hit, if lava is what we are made of.
 *
 * The material gate lives HERE rather than in wall-erosion.ts so that module
 * stays generic — it erodes walls by an amount and knows nothing about
 * marbles, which is what lets a future borer or acid hazard reuse it.
 */
export function lavaMeltIfActive(nx: number, nz: number, speed: number): void {
  if (activeMaterial() !== "lava") return;
  lavaMeltWall(nx, nz, speed);
}

// ── 🌑 Shadow: phasing through walls ────────────────────────────

/** True while the shadow marble is up — the ball is not solid to masonry. */
export function materialPhasesWalls(): boolean {
  return activeMaterial() === "shadow";
}

/**
 * The ride/walk sweep, honouring phasing.
 *
 * While shadow is up the step is applied FREE — no collision resolve at all —
 * except for the maze SHELL, which stays solid. Phasing out of the level would
 * put the player in unbuilt space with no floor, no grid and no way back; the
 * shell is the one wall shadow does not beat.
 *
 * Returns the same shape as moveCircle so the ride's blocked-detection (which
 * compares the result against the intended landing spot) reads a clean pass
 * through and skips the reflection — a phasing ball must not bounce off the
 * wall it is currently inside.
 */
export function phaseMove(g: Grid, x: number, z: number, r: number, dx: number, dz: number): MoveResult {
  if (!materialPhasesWalls()) return moveCircle(g, x, z, r, dx, dz);
  // Free move, then clamp inside the shell ring. The grid's world origin is
  // centred (see moveCircle), so the interior spans ±(size/2 − 1) minus the
  // ball's own radius.
  const limX = g.w / 2 - 1 - r;
  const limZ = g.h / 2 - 1 - r;
  // Every contact field is null/0: a phasing ball touched NOTHING, so the
  // kicker bands, booster lanes and surface reads downstream must all read as
  // "no contact". Returning a partial object here would have the ride pick up
  // last frame's rubber and kick a ball that is currently inside a wall.
  return {
    x: Math.max(-limX, Math.min(limX, x + dx)),
    z: Math.max(-limZ, Math.min(limZ, z + dz)),
    hitN: null,
    hitKick: null,
    hitLane: null,
    hitSurface: 0,
  };
}

/**
 * EJECT — the safety net that makes phasing shippable.
 *
 * Shadow lapses on a timer, and if it lapses while the ball is inside masonry
 * the run is over in the worst possible way: alive, unstuck-able, with no
 * message. This runs every step and, the moment phasing is NOT active but the
 * player is standing in a non-walkable tile, walks outward for the nearest
 * walkable tile and puts them on it.
 *
 * The grace window exists so this cannot fight a legitimate frame of overlap
 * (the collision resolve leaves the ball fractionally inside a wall all the
 * time); only a sustained illegal position triggers a move.
 */
export function updatePhaseEject(dt: number): void {
  const p = state.player;
  const g = state.grid;
  if (!p || !g) return;
  if (materialPhasesWalls()) {
    p.phaseStuckT = 0;
    return;
  }
  const t = worldToTile(g, p.x, p.z);
  if (isWalkable(g, t.i, t.j)) {
    p.phaseStuckT = 0;
    return;
  }
  p.phaseStuckT += dt;
  if (p.phaseStuckT < SHADOW_PHASE_GRACE) return;
  p.phaseStuckT = 0;

  // Expanding ring search for the closest walkable tile. Bounded: past this
  // radius we are not in a wall, we are in a sealed vault, and teleporting
  // across the level would be worse than the stall.
  for (let rad = 1; rad <= 8; rad++) {
    let best: { x: number; z: number; d: number } | null = null;
    for (let di = -rad; di <= rad; di++) {
      for (let dj = -rad; dj <= rad; dj++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== rad) continue; // ring only
        if (!isWalkable(g, t.i + di, t.j + dj)) continue;
        const c = tileCenter(g, t.i + di, t.j + dj);
        const d = (c.x - p.x) ** 2 + (c.z - p.z) ** 2;
        if (!best || d < best.d) best = { x: c.x, z: c.z, d };
      }
    }
    if (best) {
      p.x = best.x;
      p.z = best.z;
      state.vfx?.burst(p.x, 0.5, p.z, 0xb06fe8, 14, 3);
      showToast("🌑 PHASED OUT", "the shadow set you down outside the wall");
      return;
    }
  }
}

// ── Emitters ────────────────────────────────────────────────────

/** Which materials emit this frame — the active one plus any fusing one. */
function emittingMaterials(): MarbleMaterial[] {
  if (!state.dbgMaterialEnabled) return [];
  const p = state.player;
  if (!p) return [];
  const out: MarbleMaterial[] = [];
  if (p.materialT > 0 && p.material) out.push(p.material);
  if (p.fuseT > 0 && p.fuseMaterial && p.fuseMaterial !== p.material) out.push(p.fuseMaterial);
  return out;
}

/**
 * Fire the material's on-bounce emission. `nx,nz` is the wall's outward normal
 * (points back toward the ball); the shard fan is aimed along the reflected
 * heading. Throttled + speed-gated so it rewards flow, not wall spam.
 */
export function emitMaterialOnBounce(nx: number, nz: number): void {
  const p = state.player;
  if (!p || !state.dbgMaterialOnBounce) return;
  if (p.momSpeed < MATERIAL_EMIT_SPEED || p.materialEmitT > 0) return;
  const mats = emittingMaterials();
  if (mats.length === 0) return;
  p.materialEmitT = MATERIAL_EMIT_COOLDOWN;
  // Contact point on the wall face, and the post-bounce travel heading.
  const cx = p.x + nx * PLAYER_R;
  const cz = p.z + nz * PLAYER_R;
  const heading = Math.atan2(p.momZ, p.momX);
  for (const m of mats) {
    if (m === "diamond") {
      spawnShardBurst(cx, cz, {
        count: DIAMOND_BOUNCE_SHARDS,
        speed: DIAMOND_SHARD_SPEED,
        damage: DIAMOND_BOUNCE_DMG,
        life: 0.6,
        baseAngle: heading,
        fan: DIAMOND_BOUNCE_FAN,
        crystal: true,
      });
      // Prismatic glint at the contact point — the shards' muzzle flash.
      state.vfx?.burst(cx, 0.4, cz, MATERIALS.diamond.trail, 6, 3);
    } else if (m === "water") {
      spawnFloorFx("slick", cx, cz, WATER_SLICK_RADIUS, WATER_SLICK_LIFE);
      // A low wet splash hugging the floor.
      state.vfx?.burst(cx, 0.12, cz, MATERIALS.water.tint, 7, 2.5);
    } else if (m === "stone") {
      stoneShockwave(cx, cz, STONE_SHOCK_RADIUS, STONE_SHOCK_DMG);
    } else if (m === "storm") {
      // A sideways lightning arc perpendicular to the ball's travel — zaps the
      // corridor you just bounced across.
      const hl = Math.hypot(p.momX, p.momZ) || 1;
      stormArc(cx, cz, p.momZ / hl, -p.momX / hl);
      // Storm × water-slick → the floor is a Tesla coil: chain the shock across
      // everything standing on any wet tile (the fusion-window synergy).
      stormElectrifyWet();
    } else if (m === "shadow") {
      // A SHADOW CLONE decoy at the pre-bounce spot — nearby foes break off and
      // chase it (per-enemy lure) while it dissolves. No damage: pure evasion.
      shadowDecoy(p.x, p.z);
    } else if (m === "lava") {
      // Leave the machine HOT: every fast bounce deposits a burning puddle
      // (the fire floor-fx ticks burn DoT to anything standing in it).
      spawnFloorFx("fire", cx, cz, FIRE_PUDDLE_RADIUS, FIRE_PUDDLE_LIFE);
      state.vfx?.burst(cx, 0.2, cz, MATERIALS.lava.tint, 6, 2.5);
    }
  }
}

/** Spawn a shadow-clone decoy: an ink afterimage at (x,z) that nearby foes
 *  peel off to chase (lureT), buying the shadow ball a window to slip away. */
function shadowDecoy(x: number, z: number): void {
  const p = state.player;
  for (const zmb of state.zombies) {
    if (zmb.mode === "dead") continue;
    const dx = zmb.x - x;
    const dz = zmb.z - z;
    if (dx * dx + dz * dz > SHADOW_LURE_RADIUS * SHADOW_LURE_RADIUS) continue;
    zmb.lureT = SHADOW_LURE_TIME;
    zmb.lureX = x;
    zmb.lureZ = z;
  }
  if (p) state.vfx?.ghost(p.sprite.mesh, MATERIALS.shadow.trail, 0.4, 0.55);
  state.vfx?.burst(x, 0.25, z, MATERIALS.shadow.tint, 6, 1.5);
}

/** A storm lightning arc from (cx,cz) along a unit dir — a narrow damage lane
 *  rendered with the jagged bolt VFX (reuses the CARD_BOLT lane geometry). */
function stormArc(cx: number, cz: number, nx: number, nz: number): void {
  for (const zmb of state.zombies) {
    if (zmb.mode === "dead") continue;
    const rx = zmb.x - cx;
    const rz = zmb.z - cz;
    const along = rx * nx + rz * nz;
    if (along < -0.4 || along > STORM_BOUNCE_ARC_LEN) continue;
    if (Math.abs(rx * -nz + rz * nx) > STORM_BOUNCE_ARC_HALF) continue;
    damageZombie(zmb, STORM_BOUNCE_ARC_DMG, nx, nz, 0.2);
  }
  state.vfx?.bolt(cx, 0.4, cz, nx, nz, STORM_BOUNCE_ARC_LEN);
}

/** Storm synergy: discharge into every foe standing on a water slick scar. */
function stormElectrifyWet(): void {
  for (const fx of state.floorFx) {
    if (fx.kind !== "slick") continue;
    let zapped = false;
    for (const zmb of state.zombies) {
      if (zmb.mode === "dead") continue;
      const dx = zmb.x - fx.x;
      const dz = zmb.z - fx.z;
      const rr = fx.radius + ZOMBIE_R;
      if (dx * dx + dz * dz > rr * rr) continue;
      damageZombie(zmb, STORM_WET_DMG, dx, dz, 0.1);
      zapped = true;
    }
    if (zapped) state.vfx?.burst(fx.x, 0.15, fx.z, 0x9fe8ff, 6, fx.radius * 3);
  }
}

/** Fire the material's pounce-slam emission (bigger than a bounce). */
export function materialSlam(): void {
  const p = state.player;
  if (!p || !state.dbgMaterialSlam) return;
  const mats = emittingMaterials();
  for (const m of mats) {
    if (m === "diamond") {
      const rage = p.rageT > 0 ? 1.5 : 1;
      spawnShardBurst(p.x, p.z, {
        count: Math.round(DIAMOND_SLAM_SHARDS * rage),
        speed: DIAMOND_SLAM_SPEED,
        damage: DIAMOND_SLAM_DMG,
        life: 0.7,
        crystal: true,
      });
      state.vfx?.burst(p.x, 0.5, p.z, MATERIALS.diamond.trail, 14, 5);
    } else if (m === "water") {
      for (let n = 0; n < WATER_SLAM_SLICKS; n++) {
        const a = (n / WATER_SLAM_SLICKS) * Math.PI * 2;
        const r = WATER_SLICK_RADIUS * 1.2; // spread the splash patch out around you
        spawnFloorFx("slick", p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, WATER_SLICK_RADIUS, WATER_SLICK_LIFE);
      }
      // A forward speed kick (steam-launch feel), capped to the material ceiling.
      p.momSpeed = Math.min(materialMaxSpeed(), p.momSpeed + WATER_SLAM_SPEED_KICK);
      state.vfx?.burst(p.x, 0.15, p.z, MATERIALS.water.tint, 12, 4);
    } else if (m === "stone") {
      // Boulder slam: trade current speed for a big AoE. Bigger the faster you were.
      const dmg = STONE_SLAM_BASE_DMG + STONE_SLAM_DMG_PER_SPEED * p.momSpeed;
      stoneShockwave(p.x, p.z, STONE_SLAM_RADIUS, dmg);
      p.momSpeed *= 0.3; // most of it went into the ground
      state.shakeT = Math.max(state.shakeT, 0.4);
    } else if (m === "storm") {
      thunderclap(p.x, p.z);
      // ⚡ STORM'S SPECIAL: the clap is the wind-up, and then you BECOME the
      // bolt — 2.5 seconds of uncontrolled ricochet. Fired from the slam
      // because the slam is already storm's committed, deliberate input; giving
      // it a new button would have made the loudest thing in the material set
      // the one thing you never press by accident.
      enterRicochetForm("bolt");
    } else if (m === "shadow") {
      voidImplosion(p.x, p.z);
    } else if (m === "lava") {
      // ERUPTION: a ring of fire puddles around you — a burning arena.
      for (let n = 0; n < LAVA_SLAM_GLOBS; n++) {
        const a = (n / LAVA_SLAM_GLOBS) * Math.PI * 2;
        const r = LAVA_SLAM_FIRE_RADIUS * 1.3;
        spawnFloorFx("fire", p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, LAVA_SLAM_FIRE_RADIUS, LAVA_SLAM_FIRE_LIFE);
      }
      state.vfx?.burst(p.x, 0.4, p.z, MATERIALS.lava.tint, 18, 4);
      state.shakeT = Math.max(state.shakeT, 0.3);
    }
  }
}

/** 🌑 VOID IMPLOSION: violently yank every nearby foe inward (they crush
 *  together and take collision damage), then release — a gravity-well panic
 *  button. Reuses moveCircle so nobody is shoved into a wall. */
function voidImplosion(x: number, z: number): void {
  const g = state.grid;
  for (const zmb of state.zombies) {
    if (zmb.mode === "dead") continue;
    const dx = x - zmb.x;
    const dz = z - zmb.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > SHADOW_IMPLODE_RADIUS * SHADOW_IMPLODE_RADIUS) continue;
    const d = Math.hypot(dx, dz) || 1;
    const pull = d * SHADOW_IMPLODE_PULL; // fraction of the way to the centre
    if (g) {
      const r = moveCircle(g, zmb.x, zmb.z, ZOMBIE_R, (dx / d) * pull, (dz / d) * pull);
      zmb.x = r.x;
      zmb.z = r.z;
    }
    damageZombie(zmb, SHADOW_IMPLODE_DMG, -dx, -dz, 0);
  }
  // Collapsing ring of ink motes + a dark core.
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    state.vfx?.mote(x + Math.cos(a) * SHADOW_IMPLODE_RADIUS * 0.6, 0.3, z + Math.sin(a) * SHADOW_IMPLODE_RADIUS * 0.6);
  }
  state.vfx?.burst(x, 0.4, z, MATERIALS.shadow.trail, 14, 1.5);
  state.shakeT = Math.max(state.shakeT, 0.3);
}

/** ⚡ THUNDERCLAP: a ring of electricity that damages AND STUNS (freezes in
 *  place, reusing the slick's slipT with zero drift) every foe it passes. */
function thunderclap(x: number, z: number): void {
  for (const zmb of state.zombies) {
    if (zmb.mode === "dead") continue;
    const dx = zmb.x - x;
    const dz = zmb.z - z;
    const rr = STORM_CLAP_RADIUS + ZOMBIE_R;
    if (dx * dx + dz * dz > rr * rr) continue;
    damageZombie(zmb, STORM_CLAP_DMG, dx, dz, 0.5);
    // Stun = a slip with no drift → it stands frozen for the duration.
    zmb.slipT = STORM_CLAP_STUN;
    zmb.slipVX = 0;
    zmb.slipVZ = 0;
  }
  // Concentric bolt spokes + a bright ring so the clap READS as a shockwave.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    state.vfx?.bolt(x, 0.35, z, Math.cos(a), Math.sin(a), STORM_CLAP_RADIUS * 0.7);
  }
  state.vfx?.burst(x, 0.4, z, MATERIALS.storm.trail, 20, STORM_CLAP_RADIUS * 3);
  state.shakeT = Math.max(state.shakeT, 0.35);
}

/** A stone shockwave: radial damage + a dust ring (reuses the pounce-slam look). */
function stoneShockwave(x: number, z: number, radius: number, dmg: number): void {
  for (const zmb of state.zombies) {
    if (zmb.mode === "dead") continue;
    const dx = zmb.x - x;
    const dz = zmb.z - z;
    const rr = radius + ZOMBIE_R;
    if (dx * dx + dz * dz > rr * rr) continue;
    const dealt = zmb.kind === "golem" ? dmg * STONE_SHOCK_GOLEM_MULT : dmg;
    damageZombie(zmb, dealt, dx, dz, 0.8);
  }
  // Dust ring on the perimeter + a warm additive core so the wave READS
  // (dust alone sits below the bloom threshold and vanished on busy frames).
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    state.vfx?.dust(x + Math.cos(a) * radius * 0.7, 0.05, z + Math.sin(a) * radius * 0.7);
  }
  state.vfx?.burst(x, 0.1, z, MATERIALS.stone.trail, 8, radius * 3);
}

// ── MATERIAL × TERRAIN REACTIONS ────────────────────────────────
// The ball's substance reacts to hazard tiles. Called from the hazard handlers
// (pinball-collide PART_HANDLERS + hazards.simulateHazards); each is a no-op
// unless materials AND the terrain toggle are on, so the panel can flip the
// whole layer. See constants MATERIAL × TERRAIN block.

/** True when reactions are enabled AND `m` is the active ride material. */
function reactingAs(m: MarbleMaterial): boolean {
  return state.dbgMaterialTerrain && activeMaterial() === m;
}

/**
 * 💧 Water × magstrip → STEAM ERUPTION. The magnet field flash-boils the water
 * marble: instead of dragging you to a crawl, you erupt — a scalding radial
 * burst (damage + knockback) and a hard launch along your heading. Returns true
 * when it fired (the magstrip handler then SKIPS its slow + stamps a cooldown).
 */
export function tryWaterSteam(): boolean {
  const p = state.player;
  if (!p || !reactingAs("water")) return false;
  for (const zmb of state.zombies) {
    if (zmb.mode === "dead") continue;
    const dx = zmb.x - p.x;
    const dz = zmb.z - p.z;
    const rr = WATER_STEAM_RADIUS + ZOMBIE_R;
    if (dx * dx + dz * dz > rr * rr) continue;
    damageZombie(zmb, WATER_STEAM_DMG, dx, dz, 1.2);
  }
  // Erupt along your current heading (or straight up-lane if stalled).
  p.momSpeed = Math.max(p.momSpeed, WATER_STEAM_LAUNCH);
  // A white scald FLASH, a low blue splash, and then the steam it leaves behind.
  // The bursts are the impact — bright, instant, gone. The steam is the
  // aftermath, and it is the half that was missing: the reaction has always been
  // called "water → steam" and there was no steam in it, only a white spark
  // burst borrowed from the impact pool.
  state.vfx?.burst(p.x, 0.4, p.z, 0xffffff, 20, 5);
  state.vfx?.burst(p.x, 0.12, p.z, MATERIALS.water.tint, 10, 3);
  state.vfx?.steam(p.x, 0.3, p.z, 16, 3);
  spawnFloorFx("slick", p.x, p.z, WATER_SLICK_RADIUS, WATER_SLICK_LIFE);
  state.shakeT = Math.max(state.shakeT, 0.3);
  sfxSpring();
  return true;
}

/** 🪨 Stone × magstrip → PLOW: the field can't grip a boulder. Returns the
 *  effective speed clamp, or null to use the normal cap. */
export function stoneMagstripCap(): number | null {
  return reactingAs("stone") ? STONE_MAGSTRIP_CAP : null;
}

/** 🪨 Stone × oil → GRIP: a boulder doesn't hydroplane. True = ignore the slick. */
export function stoneIgnoresOil(): boolean {
  return reactingAs("stone");
}

/** 🔥 Lava × oil → VAPORIZE: the slick flashes off into flame. True = the oil
 *  handler skips greasing and a fire puddle is deposited instead. */
export function lavaVaporizesOil(x: number, z: number): boolean {
  if (!reactingAs("lava")) return false;
  spawnFloorFx("fire", x, z, FIRE_PUDDLE_RADIUS, FIRE_PUDDLE_LIFE);
  state.vfx?.burst(x, 0.2, z, MATERIALS.lava.tint, 10, 3);
  // Burning oil makes BLACK smoke, which is the read that separates this from
  // simply setting the floor alight.
  state.vfx?.smoke(x, 0.25, z, 7, 0.6);
  return true;
}

/** 🪨 Stone × pit → BRIDGE: too heavy to be swallowed while rolling; it plows
 *  across (a plume of dust) instead of falling in. */
export function stoneBridgesPit(): boolean {
  const p = state.player;
  if (!p || !reactingAs("stone") || p.momSpeed <= 0) return false;
  state.vfx?.dust(p.x, 0.05, p.z);
  state.vfx?.burst(p.x, 0.1, p.z, MATERIALS.stone.trail, 6, 2);
  return true;
}

/** 💧 Water × firevent → STEAM: the jet flash-boils the water instead of
 *  burning you. True = skip the burn (a steam puff is emitted). */
export function waterQuenchesFire(x: number, z: number): boolean {
  if (!reactingAs("water")) return false;
  state.vfx?.burst(x, 0.3, z, 0xffffff, 8, 3);
  // Quenching a fire is the single most steam-shaped event in the game, and it
  // used to be eight white sparks.
  state.vfx?.steam(x, 0.25, z, 10, 2.2);
  return true;
}

/**
 * 💎 Diamond × electric → DISCHARGE. The prismatic lattice channels a live
 * plate into a zap on nearby foes and eats the shock itself. Returns true when
 * it fired (the electric handler then SKIPS the player damage). Fires at most
 * on the plate's own zap cadence (the caller already gates on that).
 */
export function tryDiamondDischarge(x: number, z: number): boolean {
  if (!reactingAs("diamond")) return false;
  for (const zmb of state.zombies) {
    if (zmb.mode === "dead") continue;
    const dx = zmb.x - x;
    const dz = zmb.z - z;
    const rr = DIAMOND_DISCHARGE_RADIUS + ZOMBIE_R;
    if (dx * dx + dz * dz > rr * rr) continue;
    damageZombie(zmb, DIAMOND_DISCHARGE_DMG, dx, dz, 0.4);
  }
  state.vfx?.burst(x, 0.5, z, 0x9fe8ff, 16, DIAMOND_DISCHARGE_RADIUS * 3);
  return true; // absorbed regardless — diamond never takes the shock
}
