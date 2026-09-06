/**
 * Zombies — slow, dumb, numerous. Threatening in a group, trivial alone.
 *
 * Pathing: each zombie walks downhill on the shared BFS flow field that core.ts
 * recomputes every FLOW_INTERVAL. Within a couple of tiles it steers straight
 * at the player instead (the field only knows tile centres, and door-frame
 * shuffling at close range looks robotic). A cheap pairwise separation shove
 * keeps the horde from stacking into a single sprite.
 *
 * ── STEERING IS A DISPATCH TABLE, NOT A CASCADE ──
 *
 * Which of those lines a given monster walks is decided ONCE, by a lookup in
 * `MOVEMENT_HANDLERS` (entities/movement.ts), keyed by the actor's
 * `MovementKind`. Before that table this function was a ~470-line if/else chain
 * on `z.kind` in which every branch eventually reached the same three lines of
 * shared steering — twenty-two families and eight zombie sub-types all
 * approaching along one line at different speeds.
 *
 * What still lives here is everything the table deliberately does not own:
 *   · the ATTACK machine (windup → bite / glob / summon / slam / charge),
 *   · STATUS overlays that layer on top of any intent — the oil skid, the
 *     shadow lure, chill, the bat's wobble, the hobbler's limp, separation,
 *   · the whole-frame owners (`updatePin`, `updateGhost`), which are selected
 *     by movement kind rather than by `z.kind` so they cannot drift apart.
 *
 * Intent and affliction are different axes; collapsing them is how the cascade
 * grew in the first place.
 */
import { state, playerIsVisibleToEnemies, type Zombie, type EnemyKind } from "../state";
import { ZOMBIE_TYPES } from "../zombie-types";
import {
  ZOMBIE_R,
  ZOMBIE_CONTACT_RANGE,
  ZOMBIE_ATTACK_WINDUP,
  ZOMBIE_ATTACK_COOLDOWN,
  SPIDER_R,
  SPIDER_CONTACT_RANGE,
  SPIDER_ATTACK_WINDUP,
  SPIDER_ATTACK_COOLDOWN,
  BRUTE_R,
  BRUTE_CONTACT_RANGE,
  BRUTE_ATTACK_WINDUP,
  BRUTE_ATTACK_COOLDOWN,
  SPITTER_R,
  SPITTER_WINDUP,
  JESTER_R,
  JESTER_FIRE_RANGE,
  JESTER_WINDUP,
  JESTER_COOLDOWN,
  CROAKER_HOP_SPEED,
  CROAKER_HOP_TIME,
  CROAKER_HOP_CD,
  CROAKER_HOP_MIN_RANGE,
  CROAKER_HOP_BOUNCES,
  CROAKER_R,
  CROAKER_FIRE_RANGE,
  CROAKER_SPIN_RANGE,
  CROAKER_SPIN_DAMAGE,
  CROAKER_SPIN_DEFLECT,
  CROAKER_WINDUP,
  CROAKER_COOLDOWN,
  ROTORTAIL_R,
  ROTORTAIL_FIRE_RANGE,
  ROTORTAIL_WINDUP,
  ROTORTAIL_COOLDOWN,
  ROTORTAIL_HOVER_Y,
  STILTNECK_R,
  STILTNECK_FIRE_RANGE,
  STILTNECK_WINDUP,
  STILTNECK_COOLDOWN,
  SPITTER_COOLDOWN,
  SPITTER_FIRE_RANGE,
  GHOST_R,
  GHOST_CONTACT_RANGE,
  GHOST_ATTACK_WINDUP,
  GHOST_ATTACK_COOLDOWN,
  GHOST_HOVER_Y,
  GHOST_BOB_AMP,
  GHOST_BOB_SPEED,
  BAT_R,
  BAT_CONTACT_RANGE,
  BAT_ATTACK_WINDUP,
  BAT_ATTACK_COOLDOWN,
  BAT_WOBBLE_AMP,
  BAT_WOBBLE_FREQ,
  OIL_STEER_BLEND,
  BAT_HOVER_Y,
  SLIME_R,
  SLIME_CONTACT_RANGE,
  SLIME_ATTACK_WINDUP,
  SLIME_ATTACK_COOLDOWN,
  REAPER_CONTACT_RANGE,
  REAPER_ATTACK_WINDUP,
  REAPER_ATTACK_COOLDOWN,
  REAPER_SPEED_RAMP,
  REAPER_SPEED_MAX,
  AGGRO_TILES,
  aggroTiles,
  SEPARATION_R,
  STAGGER_TINT,
  PACK_RANGE,
  LOS_PROBE_RANGE,
  LOS_PROBE_STEP,
  GOBLIN_R,
  GOBLIN_KICK_SPEED,
  GOBLIN_KICK_COOLDOWN,
  PIN_R,
  PIN_SLIDE_DECAY,
  PIN_CHAIN_SPEED,
  GOLEM_R,
  GOLEM_CONTACT_RANGE,
  GOLEM_ATTACK_WINDUP,
  GOLEM_ATTACK_COOLDOWN,
  CHOMPER_R,
  CHOMPER_CONTACT_RANGE,
  CHOMPER_ATTACK_WINDUP,
  CHOMPER_ATTACK_COOLDOWN,
  MAGNET_R,
  MAGNET_CONTACT_RANGE,
  MAGNET_ATTACK_WINDUP,
  MAGNET_ATTACK_COOLDOWN,
  MAGNET_PULL_RANGE,
  MAGBOOTS_REPEL,
  MAGNET_PULL,
  MAGNET_BREAK_SPEED,
  WEBSPIN_R,
  GHOST_VULN_TIME,
  PINBALL_MAX_SPEED,
  PLAYER_R,
  WALL_CONTACT_PROBE,
  CARD_CHILL_SLOW,
  CARD_BURN_TICK,
  CARD_BURN_DMG,
  LIMP_AMP,
  LIMP_FREQ,
  HOUND_R, HOUND_CONTACT_RANGE, HOUND_ATTACK_WINDUP, HOUND_ATTACK_COOLDOWN,
  HOUND_CHARGE_SPEED, HOUND_CHARGE_TIME,
  BLOATER_R, BLOATER_CONTACT_RANGE, BLOATER_ATTACK_WINDUP, BLOATER_ATTACK_COOLDOWN,
  NECRO_R, NECRO_CONTACT_RANGE, NECRO_ATTACK_WINDUP, NECRO_ATTACK_COOLDOWN, NECRO_SUMMON_CD, NECRO_SUMMON_MAX,
  WARDEN_R, WARDEN_CONTACT_RANGE, WARDEN_ATTACK_WINDUP, WARDEN_ATTACK_COOLDOWN, WARDEN_AIM_MISS_ANGLE, WARDEN_SHIELD_RADIUS, WARDEN_SHIELD_HP, WARDEN_PULSE_CD,
  WISP_R, WISP_CONTACT_RANGE, WISP_ATTACK_WINDUP, WISP_ATTACK_COOLDOWN, WISP_BLINK_DIST, WISP_BLINK_CD,
  SAPPER_R, SAPPER_CONTACT_RANGE, SAPPER_ATTACK_WINDUP, SAPPER_ATTACK_COOLDOWN,
  CRYSTAL_R, CRYSTAL_CONTACT_RANGE, CRYSTAL_ATTACK_WINDUP, CRYSTAL_ATTACK_COOLDOWN,
  MIMIC_R, MIMIC_CONTACT_RANGE, MIMIC_ATTACK_WINDUP, MIMIC_ATTACK_COOLDOWN, MIMIC_WAKE_RANGE,
  BRUTE_HP, FISH_FEET_R } from "../constants";
import { MOVEMENT_HANDLERS, needsLos, needsPack, isCommitted, cancelCommit, type MovementKind, type Steer } from "./movement";
import { MOVEMENT_BY_KIND } from "./enemy-rules";
import { clipForSteer } from "../render/tell-clips";
import { spawnFloorFx } from "./floor-fx";
import { comboWindow } from "./combo-curve";
import { moveCircle, wallContact } from "../engine/collision";
import { worldToTile, tileCenter, idx, isWalkable, isLowWall, type Grid } from "../maze/generator";
import { flowStep } from "../engine/flow-field";
import { facingFromVelocity, type Facing } from "../engine/render/animator";
import { worldDirToScreen } from "../engine/camera";
import { hitPlayer, syncActorMesh, updateFlash, damageZombie, killZombie, resolvePlayerAttack } from "./combat";
import { fireCopBullet, fireEyeBeams, flingPlate, hurlTimber, slingBomb, spitGlob, spitWeb } from "./projectiles";
import { gate, sfxGroan, sfxGoblin, sfxSpin, sfxSwing } from "../sfx";

/** Per-family combat tuning, looked up once per zombie per frame. */
export interface EnemyStats {
  bodyR: number;
  contactRange: number;
  windup: number;
  cooldown: number;
  ranged: boolean; // spitter: attacks from afar instead of biting
}
export const STATS: Record<EnemyKind, EnemyStats> = {
  zombie: { bodyR: ZOMBIE_R, contactRange: ZOMBIE_CONTACT_RANGE, windup: ZOMBIE_ATTACK_WINDUP, cooldown: ZOMBIE_ATTACK_COOLDOWN, ranged: false },
  spider: { bodyR: SPIDER_R, contactRange: SPIDER_CONTACT_RANGE, windup: SPIDER_ATTACK_WINDUP, cooldown: SPIDER_ATTACK_COOLDOWN, ranged: false },
  brute: { bodyR: BRUTE_R, contactRange: BRUTE_CONTACT_RANGE, windup: BRUTE_ATTACK_WINDUP, cooldown: BRUTE_ATTACK_COOLDOWN, ranged: false },
  spitter: { bodyR: SPITTER_R, contactRange: SPITTER_FIRE_RANGE, windup: SPITTER_WINDUP, cooldown: SPITTER_COOLDOWN, ranged: true },
  ghost: { bodyR: GHOST_R, contactRange: GHOST_CONTACT_RANGE, windup: GHOST_ATTACK_WINDUP, cooldown: GHOST_ATTACK_COOLDOWN, ranged: false },
  bat: { bodyR: BAT_R, contactRange: BAT_CONTACT_RANGE, windup: BAT_ATTACK_WINDUP, cooldown: BAT_ATTACK_COOLDOWN, ranged: false },
  slime: { bodyR: SLIME_R, contactRange: SLIME_CONTACT_RANGE, windup: SLIME_ATTACK_WINDUP, cooldown: SLIME_ATTACK_COOLDOWN, ranged: false },
  reaper: { bodyR: GHOST_R, contactRange: REAPER_CONTACT_RANGE, windup: REAPER_ATTACK_WINDUP, cooldown: REAPER_ATTACK_COOLDOWN, ranged: false },
  // Wave-B roster (PINBALL_ROADMAP.md). Goblin/pin never bite (their contact
  // behaviour is bespoke below); their windup numbers are unused placeholders.
  goblin: { bodyR: GOBLIN_R, contactRange: 0.6, windup: 0.2, cooldown: GOBLIN_KICK_COOLDOWN, ranged: false },
  pin: { bodyR: PIN_R, contactRange: 0, windup: 1, cooldown: 1, ranged: false },
  golem: { bodyR: GOLEM_R, contactRange: GOLEM_CONTACT_RANGE, windup: GOLEM_ATTACK_WINDUP, cooldown: GOLEM_ATTACK_COOLDOWN, ranged: false },
  chomper: { bodyR: CHOMPER_R, contactRange: CHOMPER_CONTACT_RANGE, windup: CHOMPER_ATTACK_WINDUP, cooldown: CHOMPER_ATTACK_COOLDOWN, ranged: false },
  magnet: { bodyR: MAGNET_R, contactRange: MAGNET_CONTACT_RANGE, windup: MAGNET_ATTACK_WINDUP, cooldown: MAGNET_ATTACK_COOLDOWN, ranged: false },
  webspinner: { bodyR: WEBSPIN_R, contactRange: SPITTER_FIRE_RANGE, windup: SPITTER_WINDUP, cooldown: SPITTER_COOLDOWN, ranged: true },
  // Fungal shambler — zombie cadence, a touch slower on the wind-up.
  sporeling: { bodyR: ZOMBIE_R, contactRange: ZOMBIE_CONTACT_RANGE, windup: ZOMBIE_ATTACK_WINDUP * 1.15, cooldown: ZOMBIE_ATTACK_COOLDOWN, ranged: false },
  // Spring-loaded harlequin — ranged, and its contactRange IS its fire range.
  jester: { bodyR: JESTER_R, contactRange: JESTER_FIRE_RANGE, windup: JESTER_WINDUP, cooldown: JESTER_COOLDOWN, ranged: true },
  // Showman frog — spins his cane in a whirlwind strike within CROAKER_SPIN_RANGE
  croaker: { bodyR: CROAKER_R, contactRange: CROAKER_SPIN_RANGE, windup: CROAKER_WINDUP, cooldown: CROAKER_COOLDOWN, ranged: false },
  rotortail: { bodyR: ROTORTAIL_R, contactRange: ROTORTAIL_FIRE_RANGE, windup: ROTORTAIL_WINDUP, cooldown: ROTORTAIL_COOLDOWN, ranged: true },
  // Bomb-slinger — the roster's longest reach and its longest wind-up, and the
  // two are the same design decision. Its contactRange IS the sling's range.
  stiltneck: { bodyR: STILTNECK_R, contactRange: STILTNECK_FIRE_RANGE, windup: STILTNECK_WINDUP, cooldown: STILTNECK_COOLDOWN, ranged: true },
  // Its own numbers now. It borrowed GOBLIN_R and GOBLIN_KICK_COOLDOWN because
  // it was unreachable and nobody had to justify them; the goblin's cooldown in
  // particular paces a BUMPER POP, which is not what this creature does.
  fish_feet: { bodyR: FISH_FEET_R, contactRange: 0.8, windup: 0.25, cooldown: ZOMBIE_ATTACK_COOLDOWN, ranged: false },
  // ── Expansion roster (bespoke branches below carry the behaviour) ──
  hound: { bodyR: HOUND_R, contactRange: HOUND_CONTACT_RANGE, windup: HOUND_ATTACK_WINDUP, cooldown: HOUND_ATTACK_COOLDOWN, ranged: false },
  bloater: { bodyR: BLOATER_R, contactRange: BLOATER_CONTACT_RANGE, windup: BLOATER_ATTACK_WINDUP, cooldown: BLOATER_ATTACK_COOLDOWN, ranged: false },
  necromancer: { bodyR: NECRO_R, contactRange: NECRO_CONTACT_RANGE, windup: NECRO_ATTACK_WINDUP, cooldown: NECRO_ATTACK_COOLDOWN, ranged: true },
  warden: { bodyR: WARDEN_R, contactRange: WARDEN_CONTACT_RANGE, windup: WARDEN_ATTACK_WINDUP, cooldown: WARDEN_ATTACK_COOLDOWN, ranged: true },
  wisp: { bodyR: WISP_R, contactRange: WISP_CONTACT_RANGE, windup: WISP_ATTACK_WINDUP, cooldown: WISP_ATTACK_COOLDOWN, ranged: false },
  sapper: { bodyR: SAPPER_R, contactRange: SAPPER_CONTACT_RANGE, windup: SAPPER_ATTACK_WINDUP, cooldown: SAPPER_ATTACK_COOLDOWN, ranged: false },
  crystalback: { bodyR: CRYSTAL_R, contactRange: CRYSTAL_CONTACT_RANGE, windup: CRYSTAL_ATTACK_WINDUP, cooldown: CRYSTAL_ATTACK_COOLDOWN, ranged: false },
  mimic: { bodyR: MIMIC_R, contactRange: MIMIC_CONTACT_RANGE, windup: MIMIC_ATTACK_WINDUP, cooldown: MIMIC_ATTACK_COOLDOWN, ranged: false },
};

/**
 * Which policy this actor steers with: the family's row in `MOVEMENT_BY_KIND`
 * (entities/enemy-rules.ts), overridable by a zombie SUB-TYPE. One place, so no
 * second dispatch can exist anywhere.
 *
 * The override is the reason sub-types stopped being "the same monster at a
 * different speed": a Runner flanks, a Crawler ambushes, a Flailer leaps and a
 * Midget will not engage without a quorum — all off one optional field in a
 * multiplier bundle, with no new `EnemyKind` and therefore no new rows in the
 * six exhaustive Record tables (or the art they would each need).
 */
export function movementOf(z: Zombie): MovementKind {
  return (z.ztype ? ZOMBIE_TYPES[z.ztype].movement : undefined) ?? MOVEMENT_BY_KIND[z.kind] ?? "chase";
}

/** World velocity → the facing the ART thinks in (screen-relative). */
export function facingFromWorld(wx: number, wz: number, fallback: Facing): Facing {
  const s = worldDirToScreen(wx, wz);
  return facingFromVelocity(s.x, s.z, fallback);
}

// Attack-telegraph colours: melee bites flash hot red-orange (the "it's about to
// bite" tell), the spitter's ranged gob flashes acid-green to match its glob.
const TELL_MELEE = 0xff7a2a;
const TELL_RANGED = 0x8fc46b;
/** Blend white (no tint) → a warning colour by k∈0..1; k grows across the windup. */
function lerpTint(target: number, k: number): number {
  const tr = (target >> 16) & 0xff;
  const tg = (target >> 8) & 0xff;
  const tb = target & 0xff;
  // start from white (0xffffff = unmodified) so the pulse eases IN from neutral
  const r = Math.round(255 + (tr - 255) * k);
  const gg = Math.round(255 + (tg - 255) * k);
  const b = Math.round(255 + (tb - 255) * k);
  return (r << 16) | (gg << 8) | b;
}

/**
 * The shared BFS flow field's preferred heading for one actor, as a unit vector
 * — (0,0) when there is no field, or the actor already stands on the player's
 * tile. This is the ONE pathfinding substrate every policy steers on; a handler
 * that wanted its own would be building a second pathfinder, which is exactly
 * what the movement table exists to prevent.
 */
function flowHeading(g: Grid, z: Zombie): { flowX: number; flowZ: number } {
  if (!state.flowField) return { flowX: 0, flowZ: 0 };
  const t = worldToTile(g, z.x, z.z);
  const next = flowStep(g, state.flowField, t.i, t.j);
  if (!next) return { flowX: 0, flowZ: 0 };
  const c = tileCenter(g, next.i, next.j);
  const dx = c.x - z.x;
  const dz = c.z - z.z;
  const d = Math.hypot(dx, dz) || 1;
  return { flowX: dx / d, flowZ: dz / d };
}

/**
 * Is there a clear straight line of floor between two world points?
 *
 * Walked in fixed steps rather than by tile-DDA on purpose: the maze's walls are
 * a tile grid but its actors are not, and an ambusher springing through a
 * doorframe it cannot actually see through is the single thing that would make
 * the policy read as broken. Sampling errs toward "no sight", which errs toward
 * the ambusher staying hidden — the safe failure for a trap.
 *
 * Only ever called for the two policies that need it (`needsLos`), inside
 * LOS_PROBE_RANGE, and never for an actor that has already committed.
 */
function hasLineOfSight(g: Grid, ax: number, az: number, bx: number, bz: number): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const d = Math.hypot(dx, dz);
  if (d <= LOS_PROBE_STEP) return true;
  const steps = Math.ceil(d / LOS_PROBE_STEP);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const c = worldToTile(g, ax + dx * t, az + dz * t);
    if (!isWalkable(g, c.i, c.j)) return false;
  }
  return true;
}

/** No pack around: the answer for every policy that never asks. */
const NO_PACK = { packNear: 0, packCommitted: false };

/**
 * How much backup this actor has: living, awake foes within PACK_RANGE, itself
 * included — ANY of them, not just other pack-hunters. `packCommitted` is
 * narrower on purpose (a fellow pack-hunter that has already gone), because
 * that is what propagates the surge across the group in one frame.
 *
 * Counting only same-policy neighbours was the first version, and a headless
 * census on a live floor killed it: four pack-hunters spawned on a ring held at
 * 4.99 units and never engaged, because a 12%-weight sub-type is scattered far
 * wider than 5.5 units in a real maze. That is the "passes every test, never
 * occurs" failure, and the fix is also the better fantasy — the thing is not
 * waiting for other midgets, it is waiting to not be alone.
 *
 * O(n) per pack-hunter, which is why `needsPack` gates it: the horde budget is
 * 175 actors and only one sub-type ever asks.
 */
function packCensus(z: Zombie, move: MovementKind): { packNear: number; packCommitted: boolean } {
  let near = 0;
  let committed = false;
  for (const o of state.zombies) {
    if (o.mode === "dead" || !o.aggro) continue;
    const om = movementOf(o);
    if (om === "inert") continue; // a rack of bowling pins is not backup
    if (Math.hypot(o.x - z.x, o.z - z.z) > PACK_RANGE) continue;
    near++;
    if (om === move && (o.moveCommit ?? 0) > 0) committed = true;
  }
  return { packNear: near, packCommitted: committed };
}

/** NECROMANCER summon hook (injected by core to defer the spawn past the loop,
 *  like slime-split — spawning mid-iteration would corrupt the horde array). */
let onSummon: ((x: number, z: number) => void) | null = null;
export function setSummonHandler(fn: (x: number, z: number) => void): void {
  onSummon = fn;
}

/** Lock a committed dash toward (pdx,pdz). Used by Hound + woken Mimic. */
function startCharge(z: Zombie, pdx: number, pdz: number, pdist: number): void {
  const d = pdist > 1e-4 ? pdist : 1;
  z.mode = "charge";
  z.chargeT = HOUND_CHARGE_TIME;
  z.chargeDirX = pdx / d;
  z.chargeDirZ = pdz / d;
}

/** BRUTE ground-slam: a radial haymaker with wider reach than a point bite. */
function bruteSlam(z: Zombie, pdist: number, contactRange: number): void {
  const p = state.player;
  if (!p || p.hp <= 0) return;
  if (pdist <= contactRange * 1.7) hitPlayer(z);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    state.vfx?.dust(z.x + Math.cos(a) * 0.6, 0.05, z.z + Math.sin(a) * 0.6);
  }
  state.shakeT = Math.max(state.shakeT, 0.2);
}

/** CROAKER: Showman dancing cane flourish — spins cane in a 360-degree propeller attack with paddle deflection. */
function croakerCaneSpin(z: Zombie, pdist: number, contactRange: number): void {
  const p = state.player;
  const g = state.grid;
  if (!p || !g || p.hp <= 0) return;
  sfxSpin();
  sfxSwing();
  z.anim.play("attack", { force: true });
  state.vfx?.slashCircle?.(z.x, 0.45, z.z, CROAKER_SPIN_RANGE);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    state.vfx?.sparks?.(
      z.x + Math.cos(a) * (CROAKER_SPIN_RANGE * 0.7),
      0.45,
      z.z + Math.sin(a) * (CROAKER_SPIN_RANGE * 0.7),
      Math.cos(a),
      Math.sin(a),
      4,
    );
  }
  if (pdist <= CROAKER_SPIN_RANGE * 1.15) {
    hitPlayer(z);
    // Rotating paddle deflection impulse: deflect ball away from croaker
    if (pdist > 1e-4) {
      const nx = (p.x - z.x) / pdist;
      const nz = (p.z - z.z) / pdist;
      if (p.momSpeed > 0) {
        p.momX = nx;
        p.momZ = nz;
        p.momSpeed = Math.max(p.momSpeed, CROAKER_SPIN_DEFLECT);
      } else {
        const res = moveCircle(g, p.x, p.z, PLAYER_R, nx * 0.5, nz * 0.5);
        p.x = res.x;
        p.z = res.z;
      }
      state.shakeT = Math.max(state.shakeT, 0.15);
      state.vfx?.sparks?.(p.x, 0.5, p.z, nx, nz, 12);
    }
  }
}

/** NECROMANCER: raise zombie mini bunny rabbits (deferred), unless the local horde is already thick. */
function necroSummon(z: Zombie): void {
  let near = 0;
  for (const o of state.zombies) {
    if (o.mode === "dead") continue;
    if (Math.hypot(o.x - z.x, o.z - z.z) < 7) near++;
  }
  if (near >= NECRO_SUMMON_MAX) return;
  onSummon?.(z.x, z.z);
  // Dark necrotic summoning runes and sparks
  state.vfx?.sparks(z.x, 0.6, z.z, 0, 1, 18);
  state.vfx?.blood(z.x, 0.3, z.z, "green", 8);
  state.shakeT = Math.max(state.shakeT, 0.12);
}

/** WARDEN aura: top up a damage-absorb shield on every nearby living foe. */
function wardenPulse(z: Zombie): void {
  let shielded = 0;
  for (const o of state.zombies) {
    if (o === z || o.mode === "dead") continue;
    if (Math.hypot(o.x - z.x, o.z - z.z) > WARDEN_SHIELD_RADIUS) continue;
    o.shieldHp = Math.max(o.shieldHp ?? 0, WARDEN_SHIELD_HP);
    shielded++;
  }
  if (shielded > 0) state.vfx?.sparks(z.x, 0.6, z.z, 0, 1, 8);
}

function detonateCroakerCorpse(z: Zombie, index: number): void {
  state.zombies.splice(index, 1);
  if (z.sprite?.mesh?.parent) {
    z.sprite.mesh.parent.remove(z.sprite.mesh);
  }
  state.shakeT = Math.max(state.shakeT, 0.35);
  state.vfx?.ring(z.x, z.z, 0x22c55e, 1.8, 0.35);
  state.vfx?.burst(z.x, 0.5, z.z, 0x22c55e, 24, 8);
  state.vfx?.sparks(z.x, 0.5, z.z, 0, 0, 14);
  state.vfx?.blood(z.x, 0.5, z.z, "green", 30);
  state.vfx?.smoke(z.x, 0.4, z.z, 8, 0.8);

  const radius = 1.8;
  const r2 = radius * radius;
  for (const zb of state.zombies) {
    if (zb.mode === "dead" || zb.kind === "reaper") continue;
    const dx = zb.x - z.x;
    const dz = zb.z - z.z;
    const d2 = dx * dx + dz * dz;
    if (d2 <= r2) {
      const d = Math.sqrt(d2) || 1;
      damageZombie(zb, 3, dx / d, dz / d, 0.8, true, "ranged");
      state.vfx?.blood(zb.x, 0.5, zb.z, "red", 6);
    }
  }
}

export function updateZombies(dt: number): void {
  const g = state.grid;
  const p = state.player;
  if (!g) return;

  for (let i = state.zombies.length - 1; i >= 0; i--) {
    const z = state.zombies[i];
    updateFlash(z, dt);
    if (z.hp <= 0 && z.mode !== "dead") {
      killZombie(z);
    }
    if (z.mode === "dead" || (z.anim as any).isDying?.() || (z.anim as any).isDead?.()) {
      z.corpseT = (z.corpseT ?? 0) + dt;
      if (z.kind === "croaker" && p && p.hp > 0) {
        const dx = z.x - p.x;
        const dz = z.z - p.z;
        const triggerR = PLAYER_R + CROAKER_R;
        if (dx * dx + dz * dz <= triggerR * triggerR) {
          detonateCroakerCorpse(z, i);
        }
      }
      continue; // the death clip plays out; the corpse stays (unless exploded)
    }

    if (!p) continue;

    // The ONE steering decision. Everything below that branches on this reads
    // the policy, never the family — so a kind can never be handled by two
    // different movement rules in two different places in this function.
    const move = movementOf(z);

    // ── FREEZE RAY ── the whole machine holds its breath. Enemies stop
    // mid-stride, iced blue; timers don't tick, so nobody bites out of a thaw.
    if (state.freezeT > 0) {
      if (z.flashT <= 0) z.sprite.setTint(0xbfe8ff);
      z.anim.play("idle");
      continue;
    }

    // ── Ghost materialize window ── ticks down toward immunity.
    if (z.kind === "ghost") {
      z.vulnT = Math.max(0, (z.vulnT ?? 0) - dt);
      // The tell: a materialized (vulnerable) ghost is nearly solid.
      const mat = z.sprite.mesh.material as { opacity: number };
      mat.opacity = z.vulnT > 0 || z.mode === "windup" ? 0.92 : 0.55;
    }

    // ── INERT (the BOWLING PIN) ── never chases, never bites. It stands in
    // formation until something knocks it: then it SLIDES (velocity set by
    // combat), chains into pins it hits, and a wall slam finishes it.
    if (move === "inert") {
      updatePin(z, dt);
      continue;
    }

    // Per-family combat feel (bite range, windup, cooldown, body size, whether
    // it attacks at range) comes from the STATS table.
    const st = STATS[z.kind] ?? STATS.zombie;
    // ── ZOMBIE SUB-TYPE (zombie-types.ts) ──
    // The STATS table stays keyed by EnemyKind; a sub-type MULTIPLIES it. That is
    // the whole reason sub-types are not kinds: one row per family, eight
    // behaviours layered on top. An absent ztype (every non-zombie, and the
    // shambler) resolves to the identity bundle, so this costs one lookup.
    const sub = z.ztype ? ZOMBIE_TYPES[z.ztype] : null;
    const contactRange = st.contactRange * (sub?.reachMult ?? 1);
    const windup = st.windup * (sub?.windupMult ?? 1);
    // BODY RADIUS is per-KIND by default, but an actor whose sprite was scaled
    // up needs a collider that matches or it walks its visible body into walls.
    // The Reaper King was the case that exposed this: boss.ts scales its mesh
    // by 2.17x, so a 0.42 collider let a ~0.91-wide body sit half-buried in
    // 1-tile corridors. `bodyR` on the zombie overrides the table.
    const bodyR = z.bodyR ?? st.bodyR;
    const attackCooldown = st.cooldown;
    const ranged = st.ranged;

    z.cooldown = Math.max(0, z.cooldown - dt);
    z.burnT = Math.max(0, z.burnT - dt); // flame-tick immunity window
    // Gait clock. The bat branch and the ghost path each advance this for their
    // own wobble/bob, but a HOBBLER is a grounded zombie that reaches neither —
    // without this its limp phase stays pinned at 0 and it walks smoothly.
    if (sub?.gait === "limp") z.bobT = (z.bobT ?? 0) + dt;

    // ── CARD statuses (cards.ts) ── CHILL slows this frame's movement; BURN
    // ticks damage over time. Chill's factor is read at the grounded move below.
    const chillMul = (z.chillT ?? 0) > 0 ? CARD_CHILL_SLOW : 1;
    if (z.chillT) {
      z.chillT = Math.max(0, z.chillT - dt);
      // Burn announces every tick with a spark; chill's only output was a speed
      // factor. Sparse frost clinging to the slowed body evens that up.
      if (Math.random() < 2.5 * dt) state.vfx?.burst(z.x, 0.35, z.z, 0xbfe8ff, 1, 0.5);
    }
    if (z.dotT && z.dotT > 0) {
      z.dotT -= dt;
      z.dotTickT = (z.dotTickT ?? 0) - dt;
      if (z.dotTickT <= 0) {
        z.dotTickT = CARD_BURN_TICK;
        state.vfx?.sparks(z.x, 0.5, z.z, 0, 1, 3);
        damageZombie(z, z.dotDmg ?? CARD_BURN_DMG, 0, 0, 0);
        if ((z.mode as string) === "dead") continue; // burn was the finishing blow (mutated in damageZombie)
      }
    }

    // ── MIMIC ── dormant + item-like until you step close, then it BURSTS into
    // a charge. While dormant it neither chases nor is aggro'd. A mimic sited
    // near the chute must not burst on the parked knight either
    // (`playerIsVisibleToEnemies`) — you didn't step close, the floor opened
    // with you already there.
    if (z.dormant) {
      const dd = Math.hypot(p.x - z.x, p.z - z.z);
      if (dd <= MIMIC_WAKE_RANGE && p.hp > 0 && playerIsVisibleToEnemies()) {
        z.dormant = false;
        z.aggro = true;
        if (z.flashT <= 0) z.sprite.setTint(z.baseTint ?? null);
        sfxGroan();
        startCharge(z, p.x - z.x, p.z - z.z, dd);
      } else {
        z.anim.play("idle");
      }
      continue; // dormant: no AI; woken: the charge runs next frame
    }

    // ── BRUTE ENRAGE ── below 40% HP it flies into a faster, angrier rage.
    if (z.kind === "brute" && !z.enraged && z.hp <= BRUTE_HP * 0.4) {
      z.enraged = true;
      z.speed *= 1.4;
      state.vfx?.sparks(z.x, 0.75, z.z, 0, 1, 12);
      state.vfx?.blood(z.x, 0.6, z.z, "red", 6);
    }

    // ── SLIME ACID TRAIL ── it oozes a hostile burning puddle behind it on a
    // slow cadence — don't chase one down a corridor into its own wake.
    if (z.kind === "slime") {
      z.castT = (z.castT ?? 0) - dt;
      if (z.castT <= 0) {
        z.castT = 1.5;
        spawnFloorFx("fire", z.x, z.z, 0.5, 1.4, true);
      }
    }

    // ── WATER SLICK ── stepped on a marble-water scar: lost its footing and
    // slides (drift set where the slick was applied). No AI this frame — a brief
    // slapstick skid that opens the horde up. Wall-bound via moveCircle.
    if (z.slipT && z.slipT > 0) {
      z.slipT = Math.max(0, z.slipT - dt);
      const sres = moveCircle(g, z.x, z.z, bodyR, (z.slipVX ?? 0) * dt, (z.slipVZ ?? 0) * dt);
      z.x = sres.x;
      z.z = sres.z;
      z.sprite.mesh.position.set(z.x, z.sprite.mesh.position.y, z.z);
      z.anim.play("idle");
      continue;
    }

    // ── STAGGERED (entities/stagger.ts) ── the hit rocked it: no steering, no
    // attack, no leap. It drops whatever it was committed to, which is the
    // whole point — stagger is CROWD CONTROL, and a control effect that leaves
    // the wind-up running controls nothing. Placed before the aggro gate and
    // before the phase branch so ghosts freeze mid-drift too.
    if ((z.staggerT ?? 0) > 0) {
      z.staggerT = Math.max(0, (z.staggerT ?? 0) - dt);
      if (z.mode === "windup" || z.mode === "charge") {
        z.mode = "chase";
        z.windupT = 0;
      }
      cancelCommit(z);
      // `stumble` is the recoil clip (render/cel-painter.ts). It holds its last
      // frame rather than looping, so a long stagger reads as "still rocked"
      // instead of as a second hit landing. Families that have not authored one
      // fall back to `idle` in the animator, which is what this line used to be.
      z.anim.play("stumble");
      if (z.flashT <= 0) z.sprite.setTint(STAGGER_TINT);
      if (z.staggerT <= 0) {
        if (z.flashT <= 0) z.sprite.setTint(z.baseTint ?? null);
        z.anim.play("idle", { force: true });
      }
      syncActorMesh(z);
      continue;
    }

    const pdx = p.x - z.x;
    const pdz = p.z - z.z;
    const pdist = Math.hypot(pdx, pdz);

    // ── Aggro ──
    // The radius is FLOOR-RELATIVE (constants/enemies.ts aggroTiles): spawn
    // placement scales with floor size, so a fixed radius silently stopped
    // reaching the horde when floors grew 4×. Point-blank proximity (<= 1.5)
    // always wakes an enemy so close-range contact and melee never stall.
    //
    // Nothing acquires while the knight is parked in the plunger chute — see
    // `playerIsVisibleToEnemies` (state.ts) for why the whole floor used to
    // gather at the launch point while the player took their time aiming.
    if (!z.aggro && playerIsVisibleToEnemies()) {
      if (pdist <= 1.5) {
        z.aggro = true;
      } else if (state.flowField) {
        const t = worldToTile(g, z.x, z.z);
        const d = state.flowField[idx(g, t.i, t.j)];
        if (d >= 0 && d <= aggroTiles(g.w, g.h)) {
          z.aggro = true;
          if (gate("zombie-groan", 1.2)) sfxGroan();
        }
      }
    }
    if (!z.aggro) {
      z.mode = "idle";
      z.anim.play("idle");
      continue;
    }

    // ── PHASE (GHOST / REAPER) ── float STRAIGHT AT the player THROUGH walls
    // (no flow field, no moveCircle, no separation), hovering with a bob. Their
    // own self-contained update so none of the grounded stages apply — but it
    // asks the SAME dispatch table for its heading, so "through walls" is a
    // property of the frame owner and not a second copy of the steering. The
    // REAPER additionally accelerates FOREVER — the floor timer closing in.
    if (move === "phase") {
      if (z.kind === "reaper") z.speed = Math.min(REAPER_SPEED_MAX, z.speed + REAPER_SPEED_RAMP * dt);
      updateGhost(z, dt);
      continue;
    }

    // ── CROAKER HOP ── the one thing in the game that does not respect the
    // maze. Airborne it ignores knee-high walls entirely and RICOCHETS off the
    // rest; grounded it gathers, aims, and launches.
    //
    // It owns its own movement while airborne (like the hound's charge and the
    // ghost's phase), because the shared steering pipeline resolves against the
    // grid with `moveCircle`, and both of this creature's rules are exceptions
    // to exactly that resolution. Trying to express "passes through some walls
    // and bounces off others" as a steering HEADING is the wrong seam — the
    // policy hands back a direction, and what is special here is the collision.
    if (z.kind === "croaker") {
      z.hopCd = Math.max(0, (z.hopCd ?? 0) - dt);

      if ((z.hopT ?? 0) > 0) {
        z.hopT = (z.hopT ?? 0) - dt;
        const hx = z.hopDirX ?? 0;
        const hz = z.hopDirZ ?? 0;
        z.anim.setFacing(facingFromWorld(hx, hz, "S"));
        z.anim.play("run", { force: true }); // the stretched airborne pose
        const step = CROAKER_HOP_SPEED * dt;

        // Resolve each axis SEPARATELY against the grid, so a wall reflects only
        // the blocked component — the same shape as the ricocheting shard in
        // projectiles.ts, which is what makes a hop into a corner come back out
        // along the other axis instead of stopping dead.
        let bounced = false;
        const nx = z.x + hx * step;
        const tx = worldToTile(g, nx, z.z);
        // A knee-high rim is a kerb to a frog: pass straight over it. Full
        // masonry turns the hop.
        if (!isWalkable(g, tx.i, tx.j) && !isLowWall(g, tx.i, tx.j)) {
          z.hopDirX = -hx;
          bounced = true;
        } else z.x = nx;
        const nz = z.z + hz * step;
        const tz = worldToTile(g, z.x, nz);
        if (!isWalkable(g, tz.i, tz.j) && !isLowWall(g, tz.i, tz.j)) {
          z.hopDirZ = -hz;
          bounced = true;
        } else z.z = nz;

        if (bounced) {
          z.hopBounces = (z.hopBounces ?? 0) - 1;
          state.vfx?.sparks(z.x, 0.5, z.z, z.hopDirX ?? 0, z.hopDirZ ?? 0, 7);
          state.shakeT = Math.max(state.shakeT, 0.05);
          // `stumble` IS the wall-splat clip (render/monsters/croaker.ts) — the
          // ricochet has to be a visible event, or a monster changing direction
          // in mid-air reads as a pathing bug rather than as a bounce.
          z.anim.play("stumble", { force: true });
          if ((z.hopBounces ?? 0) <= 0) z.hopT = 0;
        }
        syncActorMesh(z);
        if ((z.hopT ?? 0) <= 0) {
          z.hopT = 0;
          z.hopCd = CROAKER_HOP_CD;
          state.vfx?.dust(z.x, 0.04, z.z);
        }
        continue;
      }

      // Grounded: gather and launch, but only when there is somewhere to go.
      // Hopping in the player's face would just be a worse chase — the leap is
      // for CROSSING things, so it is gated on distance.
      if (
        (z.hopCd ?? 0) <= 0 &&
        z.mode !== "windup" &&
        pdist > CROAKER_HOP_MIN_RANGE &&
        p.hp > 0 &&
        (z.moveCommit ?? 0) <= 0
      ) {
        z.hopT = CROAKER_HOP_TIME;
        z.hopBounces = CROAKER_HOP_BOUNCES;
        z.hopDirX = pdist > 1e-4 ? pdx / pdist : 1;
        z.hopDirZ = pdist > 1e-4 ? pdz / pdist : 0;
        z.anim.play("crouch", { force: true });
        state.vfx?.dust(z.x, 0.04, z.z);
        continue;
      }
      // otherwise fall through to normal kiting/steering below
    }

    // ── BUMPER GOBLIN ── it never bites: contact POPS the knight away like a
    // bumper (combo tick and all), and the goblin recoils the other way. The
    // annoyance is the point; momentum is the answer.
    if (z.kind === "goblin") {
      if (pdist <= GOBLIN_R + PLAYER_R + 0.12 && z.cooldown <= 0 && p.hp > 0) {
        z.cooldown = GOBLIN_KICK_COOLDOWN;
        const nx = pdist > 1e-4 ? pdx / pdist : 1;
        const nz = pdist > 1e-4 ? pdz / pdist : 0;
        p.momX = nx;
        p.momZ = nz;
        p.momSpeed = Math.min(PINBALL_MAX_SPEED, Math.max(p.momSpeed, GOBLIN_KICK_SPEED));
        p.bounceCombo += 1;
        p.bounceComboT = comboWindow(p.bounceCombo);
        p.iframes = Math.max(p.iframes, 0.2);

        // If player is actively executing a melee swing, connect the attack cleanly
        if (p.attackT >= 0 && !p.didHit) {
          p.didHit = true;
          resolvePlayerAttack();
        } else {
          // Bumper collision delivers impact damage to the goblin
          damageZombie(z, 1, -nx, -nz, 0.5, false, "bounce");
        }

        if (z.hp <= 0 || (z.mode as string) === "dead") {
          continue;
        }

        // The goblin recoils too — rubber meets rubber.
        const res = moveCircle(g, z.x, z.z, GOBLIN_R, -nx * 0.5, -nz * 0.5);
        z.x = res.x;
        z.z = res.z;
        state.vfx?.sparks(z.x, 0.4, z.z, nx, nz, 10);
        state.shakeT = Math.max(state.shakeT, 0.14);
        sfxGoblin();
      }
      // fall through to normal chase steering below (it keeps bouncing after you)
    }

    // ── MAGNET CRAWLER ── drags the knight in while the field holds. Wall
    // contact snaps the tether (the map is the counter); real momentum punches
    // straight through it. MAGNET BOOTS invert the field to a REPEL — the
    // crawlers become momentum ramps instead of traps.
    if (z.kind === "magnet" && p.hp > 0 && pdist < MAGNET_PULL_RANGE && pdist > 0.4) {
      const boots = p.magBootsT > 0;
      const riding = p.momSpeed >= MAGNET_BREAK_SPEED;
      const grounded = wallContact(g, p.x, p.z, PLAYER_R, WALL_CONTACT_PROBE) !== null;
      if (boots) {
        // repel: shove the knight AWAY, harder the closer they are
        const k = 1 - pdist / MAGNET_PULL_RANGE;
        const push = MAGBOOTS_REPEL * k * dt;
        const res = moveCircle(g, p.x, p.z, PLAYER_R, (pdx / pdist) * push, (pdz / pdist) * push);
        p.x = res.x;
        p.z = res.z;
        if (Math.random() < 6 * dt) state.vfx?.sparks(p.x + (pdx / pdist) * 0.4, 0.35, p.z + (pdz / pdist) * 0.4, pdx, pdz, 2);
      } else if (!riding && !grounded && p.rideT < 0) {
        const k = 1 - pdist / MAGNET_PULL_RANGE; // stronger up close
        const pull = MAGNET_PULL * k * dt;
        // pdx points magnet→player, so the drag on the player is along -pdx.
        const res = moveCircle(g, p.x, p.z, PLAYER_R, (-pdx / pdist) * pull, (-pdz / pdist) * pull);
        p.x = res.x;
        p.z = res.z;
        if (Math.random() < 6 * dt) state.vfx?.sparks(p.x - (pdx / pdist) * 0.4, 0.35, p.z - (pdz / pdist) * 0.4, -pdx, -pdz, 2);
      }
    }

    // ── CHARGE: a committed locked-line dash (Hound / woken Mimic). Bowls into
    // you for a heavy hit; slams the wall and self-stuns if it whiffs. ──
    if (z.mode === "charge") {
      z.chargeT = (z.chargeT ?? 0) - dt;
      const cdx = z.chargeDirX ?? 0;
      const cdz = z.chargeDirZ ?? 0;
      z.anim.setFacing(facingFromWorld(cdx, cdz, "S"));
      z.anim.play("walk", { force: true });
      const step = HOUND_CHARGE_SPEED * dt;
      const res = moveCircle(g, z.x, z.z, bodyR, cdx * step, cdz * step);
      const moved = Math.hypot(res.x - z.x, res.z - z.z);
      z.x = res.x;
      z.z = res.z;
      syncActorMesh(z);
      if (Math.random() < 0.6) state.vfx?.dust(z.x, 0.04, z.z);
      if (p.hp > 0 && Math.hypot(p.x - z.x, p.z - z.z) <= bodyR + PLAYER_R + 0.14) {
        hitPlayer(z);
        z.mode = "chase";
        z.cooldown = attackCooldown;
        z.chargeT = 0;
      } else if ((z.chargeT ?? 0) <= 0 || moved < step * 0.4) {
        // Whiffed or slammed a wall — recover; a wall slam costs a longer stun.
        const slammed = moved < step * 0.4;
        z.mode = "chase";
        z.cooldown = attackCooldown + (slammed ? 0.5 : 0);
        if (slammed) {
          state.vfx?.dust(z.x, 0.05, z.z);
          state.vfx?.sparks(z.x, 0.4, z.z, cdx, cdz, 6);
        }
      }
      continue;
    }

    // ── Attack windup: rooted, facing you. A melee kind bites when the windup
    // completes; a spitter (ranged) launches an acid glob instead. ──
    if (z.mode === "windup") {
      z.windupT += dt;
      z.anim.setFacing(facingFromWorld(pdx, pdz, "S"));
      // EVERY kind shows its attack clip during the windup, melee included.
      //
      // This read `ranged || z.kind === "fish_feet" ? "attack" : "idle"`, and
      // the trailing comment said "show attack clip during windup" — which it
      // did, for two of the twenty-two families. Every melee monster played
      // `idle` and advertised its swing with the colour pulse alone.
      //
      // The cost was invisible because it was silent on BOTH sides: a family
      // with a hand-posed attack (croaker's five frames, the jester's three,
      // the zombie rig's two rows of four) packed those cells into its atlas
      // and never drew one, and a family without an attack row lost nothing it
      // had. So the sheets kept getting authored and the game kept not playing
      // them. The brute's forged attack row is the case that made it visible —
      // a creature whose whole reason to exist is a readable haymaker.
      //
      // Safe for the families that DON'T author an attack: `Animator.resolved`
      // falls back per sheet, and any actor missing the row keeps playing what
      // it plays today. Safe for the ones that do: the clip is one-shot
      // (LOOPS.attack = false) and holds its final frame, which is the right
      // shape for a wind-up that ends on a strike.
      //
      // The TELEGRAPH BELOW IS UNCHANGED and still owns readability. The pulse
      // is what the dodge-roll's i-frame timing was tuned against; the clip is
      // added on top of it, not in place of it.
      z.anim.play("attack");

      // TELEGRAPH: pulse the body toward its attack colour across the windup, so
      // the bite is READABLE and a well-timed dodge-roll's i-frames can pass
      // through it (the "roll into the attack" skill). The pulse ramps up as the
      // strike nears — a brute's slow haymaker glows longest, a spider's snappy
      // bite barely flickers, matching each family's windup length. A live hit
      // flash (flashT) owns the tint, so don't fight it.
      if (z.flashT <= 0) {
        const k = Math.min(1, z.windupT / Math.max(windup, 1e-4));
        const warn = ranged ? TELL_RANGED : TELL_MELEE;
        z.sprite.setTint(lerpTint(warn, k));
      }

      if (z.windupT >= windup) {
        z.mode = "chase";
        z.cooldown = attackCooldown;
        if (z.flashT <= 0) z.sprite.setTint(z.baseTint ?? null); // drop the telegraph on release
        if (p.hp > 0) {
          if (z.kind === "mimic") {
            startCharge(z, pdx, pdz, pdist); // the windup ends in a DASH, not a bite
            continue;
          } else if (z.kind === "brute") {
            bruteSlam(z, pdist, contactRange); // a radial haymaker, not a point bite
          } else if (z.kind === "croaker") {
            croakerCaneSpin(z, pdist, contactRange); // showman spinning cane propeller attack
          } else if (z.kind === "necromancer") {
            necroSummon(z); // raise an add instead of a projectile
          } else if (ranged) {
            // Webspinners shoot silk (a slow, cleansed by parts); spitters lob a
            // TRIPLE-SPREAD acid volley (harder to sidestep than one glob).
            if (pdist > 1e-4) {
              const ux = pdx / pdist;
              const uz = pdz / pdist;
              if (z.kind === "webspinner") {
                spitWeb(z.x, z.z, ux, uz);
              } else if (z.kind === "rotortail") {
                // ONE timber, slow and heavy, straight down the line. It is
                // meant to be dodgeable — the whole design is a long visible
                // hoist followed by a shot you have time to walk out of, so a
                // spread (or a fast one) would delete the mechanic.
                hurlTimber(z.x, z.z, ux, uz);
              } else if (z.kind === "stiltneck") {
                // ONE bomb, straight down the line, exactly like the timber —
                // and for the opposite reason. The timber is a single shot
                // because it must be dodgeable; this is a single shot because
                // its BLAST already covers the ground a spread would, and two
                // overlapping explosions is not a harder problem, just a louder
                // one.
                slingBomb(z.x, z.z, ux, uz);
              } else if (z.kind === "jester") {
                // ONE plate, straight down the line — no spread. The spitter's
                // volley is hard to sidestep on purpose; the jester's is easy to
                // sidestep on purpose, because what makes it dangerous is where
                // it goes AFTER it misses.
                flingPlate(z.x, z.z, ux, uz);
              } else if (z.kind === "warden") {
                // The COP guard fires a ricocheting service bullet with a deliberate aim offset.
                // He always misses the player directly (aiming ±WARDEN_AIM_MISS_ANGLE off line)
                // so the bullet strikes a wall, bounces, and rebounds across the room to hit the player.
                const side = Math.random() < 0.5 ? 1 : -1;
                const offset = side * (WARDEN_AIM_MISS_ANGLE + (Math.random() - 0.5) * 0.08);
                const cos = Math.cos(offset);
                const sin = Math.sin(offset);
                const aimX = ux * cos - uz * sin;
                const aimZ = ux * sin + uz * cos;
                fireCopBullet(z.x, z.z, aimX, aimZ);
              } else {
                for (const ang of [-0.32, 0, 0.32]) {
                  const c = Math.cos(ang);
                  const s = Math.sin(ang);
                  spitGlob(z.x, z.z, ux * c - uz * s, ux * s + uz * c);
                }
              }
            }
          } else if (pdist <= contactRange * 1.3) {
            hitPlayer(z);
          }
        }
      }
      continue;
    }
    // Left windup without releasing (player fled out of range): clear any tell.
    if (z.flashT <= 0) z.sprite.setTint(z.baseTint ?? null);

    z.mode = "chase";
    // ── Is this actor mid-COMMIT? ──
    // A leaper's pounce is a locked arc; letting a contact windup fire out of it
    // would cancel the very attack the crouch telegraphed. The HOUND used to own
    // a bespoke straight-line charge trigger here (windup at HOUND_CHARGE_RANGE,
    // release into a dash); the `leaper` policy replaces it with a telegraphed
    // ARC, which is the de-clone — a straight dash is beaten by one sidestep,
    // an arc has to be read.
    const committed = isCommitted(move, z);
    // Melee bites in contact range; a spitter fires from anywhere in its long
    // fire range (contactRange for it is SPITTER_FIRE_RANGE). The goblin never
    // bites — its contact behaviour is the bumper kick above.
    if (!committed && z.kind !== "goblin" && pdist <= contactRange && z.cooldown <= 0 && p.hp > 0) {
      z.mode = "windup";
      z.windupT = 0;
      cancelCommit(z); // a bite out of a crouch: the leap is off
      continue;
    }

    // ── STEERING: one dispatch, one policy (entities/movement.ts) ──
    // The handler gets plain numbers and hands back a heading; nothing about
    // the maze, the sprite or the horde reaches it.
    // Line of sight and the pack census are the only two inputs a policy needs
    // that cost anything, so both are gated on the policies that read them and
    // on a cheap range pre-check. Everything else is arithmetic already to hand.
    const wantsLos = needsLos(move) && pdist <= LOS_PROBE_RANGE && !committed;
    const steer: Steer = MOVEMENT_HANDLERS[move](z, {
      dt,
      pdx,
      pdz,
      pdist,
      ...flowHeading(g, z),
      contactRange,
      los: wantsLos ? hasLineOfSight(g, z.x, z.z, p.x, p.z) : false,
      ...(needsPack(move) ? packCensus(z, move) : NO_PACK),
    });
    let vx = steer.vx;
    let vz = steer.vz;

    // ── THE TELEGRAPH ── a policy declares its tell; this paints it. A movement
    // the player cannot see coming is indistinguishable from no movement at all,
    // so the tell is part of the mechanic, not decoration on top of it. A live
    // hit flash (flashT) still owns the tint — it is the more urgent message.
    if (z.flashT <= 0) {
      if (steer.tell) z.sprite.setTint(lerpTint(steer.tell.color, steer.tell.k));
      else z.sprite.setTint(z.baseTint ?? null);
    }

    // ── SHADOW LURE ── a shadow-clone decoy has this foe's attention: it walks
    // toward the clone instead of you until the lure lapses (or it arrives).
    if (z.lureT && z.lureT > 0) {
      z.lureT = Math.max(0, z.lureT - dt);
      const lx = (z.lureX ?? z.x) - z.x;
      const lz = (z.lureZ ?? z.z) - z.z;
      const ld = Math.hypot(lx, lz) || 1;
      vx = lx / ld;
      vz = lz / ld;
    }

    // ── Separation — shove apart any living neighbours that overlap ──
    let sx = 0;
    let sz = 0;
    for (const other of state.zombies) {
      if (other === z || other.mode === "dead") continue;
      const dx = z.x - other.x;
      const dz = z.z - other.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-4 && d < SEPARATION_R) {
        const push = (SEPARATION_R - d) / SEPARATION_R;
        sx += (dx / d) * push;
        sz += (dz / d) * push;
      }
    }

    // ── OIL skid ── a greased foe can't steer: its travelled heading only
    // BLENDS toward where it wants to go, so it slides past turns (and past
    // you) until the grease wears off. Bats fly above the pool — unaffected.
    if (z.oiledT && z.oiledT > 0 && z.kind !== "bat") {
      z.oiledT = Math.max(0, z.oiledT - dt);
      if (vx !== 0 || vz !== 0) {
        const hx = z.oilHX ?? vx;
        const hz = z.oilHZ ?? vz;
        const k = Math.min(1, OIL_STEER_BLEND * dt);
        const nx = hx + (vx - hx) * k;
        const nz = hz + (vz - hz) * k;
        const len = Math.hypot(nx, nz) || 1;
        z.oilHX = nx / len;
        z.oilHZ = nz / len;
        vx = z.oilHX;
        vz = z.oilHZ;
      }
      if (z.oiledT === 0) {
        z.oilHX = undefined;
        z.oilHZ = undefined;
      }
    }

    // ── BAT wobble ── a sine weave ACROSS the flight line so it's hard to
    // line up a swing on: perturb the steer direction with a perpendicular
    // oscillation (still wall-bound via moveCircle — it flies the corridors).
    if (z.kind === "bat" && (vx !== 0 || vz !== 0)) {
      z.bobT = (z.bobT ?? 0) + dt;
      const w = Math.sin(z.bobT * BAT_WOBBLE_FREQ) * BAT_WOBBLE_AMP;
      const px = -vz * w;
      const pz = vx * w;
      const len = Math.hypot(vx + px, vz + pz) || 1;
      vx = (vx + px) / len;
      vz = (vz + pz) / len;
    }

    // Golems and chompers are FURNITURE WITH TEETH: rooted, never shoved by
    // the horde's separation pass — they hold their chokepoint. The flag comes
    // off the steer (the `rooted` policy) rather than off a kind test, so a
    // family becomes furniture by changing one table column.
    const rooted = steer.rooted === true;
    // The HOBBLER's LIMP: lurch forward, drag the bad leg, lurch again. The phase
    // is seeded from the nid (core.makeZombie) rather than wall-clock, so it is
    // per-actor distinct AND identical on every co-op peer. Floored at 0 because
    // a large amplitude would otherwise drive the multiplier negative and walk
    // the zombie backwards.
    const gait = sub?.gait === "limp"
      ? Math.max(0, 1 + LIMP_AMP * Math.sin((z.bobT ?? 0) * LIMP_FREQ + (z.gaitPhase ?? 0)))
      : 1;
    // A policy that LOCKS a line (a committed pounce) must not be shoved off it
    // by the separation pass — the arc is the mechanic, and a horde nudging it
    // sideways would make the telegraph a lie.
    const shove = steer.locked ? 0 : 1.5;
    const mult = steer.mult ?? 1;
    const mx = rooted ? 0 : (vx * z.speed * chillMul * gait * mult + sx * shove) * dt;
    const mz = rooted ? 0 : (vz * z.speed * chillMul * gait * mult + sz * shove) * dt;
    if (mx !== 0 || mz !== 0) {
      const res = moveCircle(g, z.x, z.z, bodyR, mx, mz);
      z.x = res.x;
      z.z = res.z;
    }

    // A policy's TELL may also name a POSE, not just a tint (render/tell-clips.ts).
    // The tint alone made a crouching leaper, a stalking pack-hunter and a
    // committed ambusher play the same clip in three colours; the clip is the
    // half of the telegraph that reads at a glance across a lit room.
    const moving = vx !== 0 || vz !== 0;
    const tellClip = clipForSteer(steer, moving);
    if (moving && !steer.hold) {
      z.anim.setFacing(facingFromWorld(vx, vz, "S"));
      z.anim.play(tellClip ?? "walk");
    } else {
      // `hold` is a policy STANDING STILL on purpose (an ambusher in wait, a
      // leaper mid-crouch). It must read as stillness, not as a walk cycle in
      // place, or the telegraph the whole policy rests on is invisible.
      if (steer.hold && moving) z.anim.setFacing(facingFromWorld(vx, vz, "S"));
      z.anim.play(tellClip ?? "idle");
    }

    syncActorMesh(z);
    // A bat FLIES: lift its billboard off the floor with a quick flutter-bob.
    if (z.kind === "bat") {
      z.sprite.mesh.position.y = BAT_HOVER_Y + Math.sin((z.bobT ?? 0) * 9) * 0.06;
    }
    // So does a ROTORTAIL, higher and slower — a rotor holds a heavy body on a
    // long lazy bob where a wing beats. The two flyers are told apart in a crowd
    // by ALTITUDE and CADENCE before either sprite is legible, which is the whole
    // reason this is its own branch rather than a shared constant.
    if (z.kind === "rotortail") {
      z.bobT = (z.bobT ?? 0) + dt;
      z.sprite.mesh.position.y = ROTORTAIL_HOVER_Y + Math.sin(z.bobT * 2.6) * 0.1;
    }
  }
}

/**
 * The GHOST update (also the REAPER — same spectral drift, meaner numbers):
 * drift STRAIGHT toward the player through walls (no maze pathing, no
 * collision), hovering with a gentle bob. It still winds up and lands a
 * chilling touch in contact range, reusing the same telegraph pulse.
 * Self-contained — called in place of all the grounded steering above.
 */
function updateGhost(z: Zombie, dt: number): void {
  const p = state.player;
  if (!p) return;
  const st = STATS[z.kind] ?? STATS.ghost;
  // The reaper's resting look is blood-red, not untinted — every place the
  // ghost path clears its telegraph tint, the reaper re-dyes instead.
  const baseTint = z.baseTint ?? null;
  const pdx = p.x - z.x;
  const pdz = p.z - z.z;
  const pdist = Math.hypot(pdx, pdz);

  z.bobT = (z.bobT ?? 0) + dt;

  // ── Windup: reach out, then the touch lands. Same telegraph as the melee kinds. ──
  if (z.mode === "windup") {
    z.windupT += dt;
    z.anim.setFacing(facingFromWorld(pdx, pdz, "S"));
    z.anim.play("idle");
    if (z.flashT <= 0) {
      const k = Math.min(1, z.windupT / Math.max(st.windup, 1e-4));
      z.sprite.setTint(lerpTint(TELL_MELEE, k));
    }
    if (z.windupT >= st.windup) {
      z.mode = "chase";
      z.cooldown = st.cooldown;
      if (z.flashT <= 0) z.sprite.setTint(baseTint);
      if (p.hp > 0 && pdist <= st.contactRange * 1.3) hitPlayer(z);
    }
    syncGhostMesh(z);
    return;
  }
  if (z.flashT <= 0) z.sprite.setTint(baseTint);

  // Enter windup in contact range; otherwise drift straight in (through walls).
  z.mode = "chase";
  if (pdist <= st.contactRange && z.cooldown <= 0 && p.hp > 0) {
    z.mode = "windup";
    z.windupT = 0;
    // A ghost MATERIALIZES to strike — and stays touchable for the window
    // after (the only time steel can find it). The reaper stays immune.
    if (z.kind === "ghost") z.vulnT = GHOST_VULN_TIME;
    syncGhostMesh(z);
    return;
  }

  // The heading comes from the SAME dispatch table the grounded horde uses
  // (the `phase` policy) — what makes a ghost a ghost is that this function
  // integrates the result without moveCircle, not that it computes a different
  // direction.
  const drift = MOVEMENT_HANDLERS.phase(z, {
    dt,
    pdx,
    pdz,
    pdist,
    flowX: 0,
    flowZ: 0,
    contactRange: st.contactRange,
    los: true, // it passes through walls; sight lines are never its problem
    packNear: 0,
    packCommitted: false,
  });
  if (drift.vx !== 0 || drift.vz !== 0) {
    // NO moveCircle — the ghost passes through walls. Just integrate position.
    z.x += drift.vx * z.speed * dt;
    z.z += drift.vz * z.speed * dt;
    z.anim.setFacing(facingFromWorld(drift.vx, drift.vz, "S"));
  }
  z.anim.play("walk");
  syncGhostMesh(z);
}

/**
 * Position a ghost's billboard: the shared iso transform, then LIFT it off the
 * floor to GHOST_HOVER_Y plus a sine bob so it visibly floats. syncActorMesh
 * pins y=0; we override just the y after it runs.
 */
function syncGhostMesh(z: Zombie): void {
  syncActorMesh(z);
  const bob = Math.sin((z.bobT ?? 0) * GHOST_BOB_SPEED) * GHOST_BOB_AMP;
  z.sprite.mesh.position.y = GHOST_HOVER_Y + bob;
}

/**
 * The BOWLING PIN update: integrate the slide velocity a knockback handed it
 * (combat.ts sets slideVX/VZ instead of an instant shove for pins), decaying
 * with floor friction. A sliding pin that reaches another pin passes the hit
 * on (the chain reaction — this is the whole bowling fantasy); a pin that
 * slams a wall at speed goes down on the spot.
 */
function updatePin(z: Zombie, dt: number): void {
  const g = state.grid;
  if (!g) return;
  const vx = z.slideVX ?? 0;
  const vz = z.slideVZ ?? 0;
  const speed = Math.hypot(vx, vz);
  if (speed < 0.05) {
    z.slideVX = 0;
    z.slideVZ = 0;
    z.anim.play("idle");
    syncActorMesh(z);
    return;
  }

  const res = moveCircle(g, z.x, z.z, PIN_R, vx * dt, vz * dt);
  const blockedX = Math.abs(res.x - (z.x + vx * dt)) > 1e-3;
  const blockedZ = Math.abs(res.z - (z.z + vz * dt)) > 1e-3;
  z.x = res.x;
  z.z = res.z;

  // Wall slam: the pin goes down (damage routed through the shared funnel so
  // strikes/kill bookkeeping all fire). Push 0 — it's already at the wall.
  if ((blockedX || blockedZ) && speed >= PIN_CHAIN_SPEED) {
    z.slideVX = 0;
    z.slideVZ = 0;
    state.vfx?.dust(z.x, 0.1, z.z);
    damageZombie(z, 1, vx, vz, 0);
    return;
  }

  // Chain: a fast pin reaching a standing pin knocks it onward.
  if (speed >= PIN_CHAIN_SPEED) {
    for (const other of state.zombies) {
      if (other === z || other.kind !== "pin" || other.mode === "dead") continue;
      const dx = other.x - z.x;
      const dz = other.z - z.z;
      if (dx * dx + dz * dz > (PIN_R * 2.2) * (PIN_R * 2.2)) continue;
      damageZombie(other, 1, vx, vz, 0.9); // combat hands ITS pins a slide too
      // This pin spends most of its speed on the impact.
      z.slideVX = vx * 0.35;
      z.slideVZ = vz * 0.35;
      break;
    }
  }

  // Floor friction.
  const decel = PIN_SLIDE_DECAY * dt;
  const ns = Math.max(0, speed - decel);
  z.slideVX = (vx / speed) * ns;
  z.slideVZ = (vz / speed) * ns;
  z.anim.play("walk"); // the wobble clip doubles as the slide
  syncActorMesh(z);
}

