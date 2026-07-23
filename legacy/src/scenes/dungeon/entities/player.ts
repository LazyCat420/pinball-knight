/**
 * The hero — grid-free continuous movement, a 4-way facing, and an attack
 * that depends on what's in the active hand:
 *
 *  - MELEE: a three-frame swing whose hitbox agrees with its animation (the
 *    active window covers exactly the middle "strike" frame).
 *  - RANGED: the shot leaves the muzzle the instant the trigger pulls (a gun
 *    with a windup feels broken), ammo is spent per shot, and fast weapons
 *    (the flamethrower) can re-fire while the fire animation is still playing.
 *
 * Attack numbers come from whatever weapon is currently in the active slot;
 * boots come from the gear slots.
 */
import { state, activeWeapon } from "../state";
import { skillAgg } from "../skill-runtime";
import {
  PLAYER_SPEED,
  PLAYER_R,
  ZOMBIE_R,
  BOOTS_SPEED_FACTOR,
  SPRINT_SPEED_MULT,
  SPRINT_BASE_MULT,
  SPRINT_RAMP_TIME,
  SPRINT_DECAY_TIME,
  SPRINT_GRACE,
  SPRINT_RIDE_THRESHOLD,
  RUN_CLIP_THRESHOLD,
  RUN_RATE_RAMP,
  AURA_MIN_CHARGE,
  AURA_INTERVAL,
  AURA_LIFE,
  AURA_OPACITY,
  AURA_TINT_COOL,
  AURA_TINT_HOT,
  AURA_HOT_CHARGE,
  BUFF_TELL_INTERVAL,
  TELL_TINT_RAGE,
  TELL_TINT_HASTE,
  TELL_TINT_SHIELD,
  SHIELD_RING_INTERVAL,
  SHIELD_RING_MOTES,
  SHIELD_RING_RADIUS,
  WALLRIDE_SLIDE_BOOST,
  GRIND_SPARK_INTERVAL,
  OVERCHARGE_TIME,
  OVERCHARGE_DECAY,
  PINBALL_WALL_RESTITUTION,
  PINBALL_MAX_SPEED,
  PINBALL_FRICTION,
  FRICTION_OPEN,
  FRICTION_CORRIDOR,
  FRICTION_TIGHT,
  LANE_CENTER_PULL,
  LANE_PROBE_MAX,
  PINBALL_STEER,
  PINBALL_EXIT_MULT,
  BALL_SPEED_MULT,
  FRENZY_BALL_SPEED_MULT,
  BALL_RAM_COOLDOWN,
  BALL_RAM_KNOCKBACK,
  RAMP_SPEED,
  RAMP_HOP_HEIGHT,
  RAMP_HOP_MIN,
  RAMP_HOP_MAX,
  RAMP_HOP_SPEED,
  ARC_BANK_RADIUS,
  ARC_BOOST,
  ARC_COOLDOWN,
  ARC_MIN_SPEED,
  SECRET_BREAK_SPEED,
  WALL_BREAK_SPEED,
  WALL_BREAK_SPEED_COST,
  OIL_STEER_FACTOR,
  TRAPDOOR_RIDE_SPEED,
  TRAPDOOR_RIDE_MIN,
  TRAPDOOR_RIDE_MAX,
  TRAPDOOR_EXIT_SPEED,
  TRAPDOOR_HEIGHT,
  TRAPDOOR_COOLDOWN,
  TRAPDOOR_OPEN,
  TRAPDOOR_DROP,
  TRAPDOOR_DROP_DEPTH,
  TRAPDOOR_RISE,
  WEB_SLOW_MULT,
  IRONCORE_RAM_MULT,
  TURBO_STEER_MULT,
  TURBO_WALK_MULT,
  SPRINGLEGS_RESTITUTION,
  MAGSTRIP_WALK_MULT,
  MOVE_ACCEL,
  MOVE_FRICTION,
  ROLL_DURATION,
  ROLL_IFRAMES,
  ROLL_DISTANCE,
  ROLL_RECOVERY,
  ROLL_MIN_SPEED,
  PLUNGER_SPEED,
  PLUNGER_MIN_SPEED,
  PLUNGER_CHARGE_TIME,
  PLUNGER_AIM_MAX,
  PLUNGER_AIM_RATE,
  LIGHT_1,
  LIGHT_2,
  COMBO_FINISH,
  FINISHER_FLASH_T,
  HEAVY,
  COMBO_WINDOW,
  CHARGE_TIME,
  INPUT_BUFFER,
  WALL_CONTACT_PROBE,
  WALLKICK,
  WALLKICK_DURATION,
  WALLKICK_IFRAMES,
  WALLKICK_DISTANCE,
  WALLRIDE,
  POUNCE,
  POUNCE_DURATION,
  POUNCE_IFRAMES,
  POUNCE_DISTANCE,
  POUNCE_AOE,
  type MoveTiming,
} from "../constants";
import { HASTE_SPEED_MULT, HASTE_COOLDOWN_MULT } from "../items";
import { moveCircle, wallContact } from "../collision";
import { at, T_CRACKED, isWalkable, tileCenter, worldToTile, type Grid } from "../maze/generator";

import { showPickupNote, showToast } from "../ui";
import { smashSecretAt, smashWallAt, wallRunDepth } from "../secrets";
import { rotateLanes, armSkillShot } from "../shots";
import { facingFromVelocity, type Facing } from "../render/animator";
import { screenDirToWorld, worldDirToScreen, mouseAimDirection } from "../camera";
import { InputHandle } from "../input";
import { WEAPONS } from "../items";
import { resolvePlayerAttack, wearActiveWeapon, syncActorMesh, updateFlash, FACING_VEC, damageZombie, playerDamage, applyCardOnHit } from "./combat";
import { aggregateCards } from "../cards";
import { fireWeapon } from "./projectiles";
import {
  MATERIALS,
  materialFlatRestitution,
  materialBreakSpeeds,
  materialFrictionMult,
  materialSteerMult,
  materialLanePull,
  materialPlayerR,
  materialRamKnockback,
  materialCornerAddMult,
  materialMaxSpeed,
  emitMaterialOnBounce,
  materialSlam,
} from "./marble";
import { sfxSwing, sfxGun, sfxBow, sfxFlame, sfxRoll, sfxHeavy, sfxTrapdoor, sfxSpring, sfxBumper } from "../audio";
import { comboSpeedCeil, comboCornerRestitution, comboCornerAdd, comboWindow, comboFrictionMul, comboZone } from "./combo-curve";

import { touchPinballParts, overMagStrip, onPartTrigger, type PinballDeps } from "./pinball-collide";

/**
 * The player-owned behaviours a pinball part can trigger. Handed to the parts
 * sweep so entities/pinball-collide.ts never has to import back into this file.
 */
const PINBALL_DEPS: PinballDeps = {
  startRampHop: (dirX, dirZ, speed) => startRampHop(dirX, dirZ, speed),
  startDrop: (x, z) => startDrop(x, z),
  setSteerLock: (t) => {
    steerLockT = t;
  },
  raiseSteerLock: (t) => {
    steerLockT = Math.max(steerLockT, t);
  },
};

/** Attacking roots you a little — swinging at a full sprint feels weightless. */
const ATTACK_MOVE_FACTOR = 0.45;

/** Footstep-dust cadence — a puff kicks up this often while walking. */
const STEP_DUST_INTERVAL = 0.26;
let stepDustT = 0;

/**
 * Smoothed current speed (units/sec), ramped toward the target each frame so
 * walk↔sprint reads as a gear change, not an instant teleport to full speed.
 * Module-local (single player, singleton game) like stepDustT above.
 */
let curSpeed = 0;

/** Countdown holding the sprint charge steady through a brief interruption. */
let sprintGraceT = 0;

/** Cadence timers: speed-aura afterimages + wall-grind spark bursts. */
let auraT = 0;
let grindT = 0;

/** No-steer window after a dash panel (Sonic's booster move-lock). */
let steerLockT = 0;

/** Reset per-run movement smoothing so a fresh descent doesn't inherit momentum. */
export function resetPlayerMotion(): void {
  curSpeed = 0;
  stepDustT = 0;
  sprintGraceT = 0;
  auraT = 0;
  grindT = 0;
  steerLockT = 0;
  if (state.player) {
    state.player.sprintCharge = 0;
    state.player.overcharge = 0;
    state.player.momSpeed = 0;
    state.player.bounceCombo = 0;
    state.player.bounceComboT = 0;
    state.player.oilT = 0;
    state.player.webbedT = 0;
    state.player.rideT = -1;
    state.player.ridePts = [];
    state.player.dropT = -1;
    state.player.sprite.mesh.position.y = 0; // in case a level change caught a ride mid-flight
  }
}

/**
 * Drop a fading afterimage of the knight — the speed aura. Cool arcane-blue
 * while the sprint spools, GOLD at full charge / during wall tricks. Cadence
 * is owned by the shared auraT timer so sprint, roll and wall launches all
 * feed one trail instead of stacking three.
 */
function spawnAura(dt: number, interval: number, hot: boolean, life = AURA_LIFE, opacity = AURA_OPACITY): void {
  const p = state.player;
  if (!p) return;
  auraT -= dt;
  if (auraT > 0) return;
  auraT = interval;
  state.vfx?.ghost(p.sprite.mesh, hot ? AURA_TINT_HOT : AURA_TINT_COOL, life, opacity);
}

/** Cadence timers for the per-buff world tells (separate from the sprint aura). */
let buffTellT = 0;
let shieldRingT = 0;
let materialMoteT = 0;

/**
 * BUFF WORLD-TELLS — every timed buff gets a look, not just a HUD tile.
 *
 * Rage, Shield and Haste used to exist ONLY as a number in the corner: Rage was
 * a bare damage multiply, Shield an early-return in the damage path (so it read
 * as "the enemies keep missing"), Haste a speed you could feel but never see.
 * Curve Shot is the good example to copy — it works because you WATCH the
 * bullets bend. Each tell below is colour-coded to that buff's potion so the
 * flask you drank and the aura you're wearing are obviously the same thing.
 */
function updateBuffTells(dt: number): void {
  const p = state.player;
  if (!p || !state.vfx) return;

  buffTellT -= dt;
  if (buffTellT <= 0) {
    buffTellT = BUFF_TELL_INTERVAL;
    // Afterimages tinted to the active buff. Rage wins over Haste when both
    // run — the damage buff is the one you need to read at a glance.
    if (p.rageT > 0) state.vfx.ghost(p.sprite.mesh, TELL_TINT_RAGE, 0.3, 0.42);
    else if (p.hasteT > 0) state.vfx.ghost(p.sprite.mesh, TELL_TINT_HASTE, 0.26, 0.34);
    if (p.shieldT > 0) state.vfx.ghost(p.sprite.mesh, TELL_TINT_SHIELD, 0.34, 0.3);
    // MARBLE MATERIAL — the ball's substance gets its own trail hue (distinct
    // from every potion tell), stacking with the buff ghosts above. During a
    // fusion window both materials shed images — two colours interleaved.
    if (p.material && p.materialT > 0) {
      state.vfx.ghost(p.sprite.mesh, MATERIALS[p.material].trail, 0.3, 0.38);
      if (p.fuseT > 0 && p.fuseMaterial) state.vfx.ghost(p.sprite.mesh, MATERIALS[p.fuseMaterial].trail, 0.24, 0.3);
    }
  }

  // Per-material idle sparkle: diamond glints, water drips, stone crumbles —
  // a slow ambient tell so the material reads even standing still.
  if (p.material && p.materialT > 0) {
    materialMoteT -= dt;
    if (materialMoteT <= 0) {
      materialMoteT = 0.22;
      const a = Math.random() * Math.PI * 2;
      const r = 0.25 + Math.random() * 0.25;
      const mx = p.x + Math.cos(a) * r;
      const mz = p.z + Math.sin(a) * r;
      if (p.material === "diamond") state.vfx.burst(mx, 0.35 + Math.random() * 0.4, mz, MATERIALS.diamond.trail, 1, 0.4);
      else if (p.material === "water") state.vfx.burst(mx, 0.15, mz, MATERIALS.water.tint, 1, 0.5);
      else if (p.material === "storm") state.vfx.burst(mx, 0.3 + Math.random() * 0.5, mz, MATERIALS.storm.trail, 2, 1.2);
      else if (p.material === "shadow") state.vfx.mote(mx, 0.2 + Math.random() * 0.4, mz);
      else if (p.material === "lava") state.vfx.ember(mx, 0.1, mz);
      else state.vfx.dust(mx, 0.05, mz);
    }
  }

  // The shield BUBBLE: a ring of motes orbiting the knight, so invulnerability
  // is a thing you can see rather than an absence of damage.
  if (p.shieldT > 0) {
    shieldRingT -= dt;
    if (shieldRingT <= 0) {
      shieldRingT = SHIELD_RING_INTERVAL;
      const spin = state.elapsed * 2.2;
      for (let k = 0; k < SHIELD_RING_MOTES; k++) {
        const a = spin + (k / SHIELD_RING_MOTES) * Math.PI * 2;
        state.vfx.sparks(p.x + Math.cos(a) * SHIELD_RING_RADIUS, 0.42, p.z + Math.sin(a) * SHIELD_RING_RADIUS, 0, 0, 1);
      }
    }
  }
}

/** Dev telemetry: the smoothed movement speed (units/sec) for the QA hook. */
export function debugCurSpeed(): number {
  return curSpeed;
}

/** Dev telemetry: the current wall normal (or null) for headless wall-move tests. */
export function debugWallNormal(): { nx: number; nz: number } | null {
  return currentWallNormal();
}

/** Peak roll speed (units/sec). v(τ)=v0·(1−τ) integrates to ROLL_DISTANCE over ROLL_DURATION. */
const ROLL_V0 = (2 * ROLL_DISTANCE) / ROLL_DURATION;

/**
 * Begin a dodge-roll if allowed. Commits the current input direction (or the
 * facing if standing still) — it's LOCKED for the whole roll, which is what
 * makes timing + aim matter. FREE (no stamina) — the game is a Sonic/pinball
 * momentum sandbox now, so tricks are never resource-gated. Returns true if the
 * roll started.
 */
function tryStartRoll(input: InputHandle): boolean {
  const p = state.player;
  const g = state.grid;
  if (!p || !g || p.rollT >= 0) return false; // already rolling

  // Momentum gate: a roll is a running move, not a standing one. You have to
  // have built up speed first — no dodge-cannon straight off the plunger park.
  if (curSpeed < ROLL_MIN_SPEED) return false;

  // Direction: the movement input if any, else the current facing's world dir.
  const a = input.axis();
  let dir = a.x !== 0 || a.z !== 0 ? screenDirToWorld(a.x, a.z) : { x: FACING_VEC[p.facing][0], z: FACING_VEC[p.facing][1] };
  const len = Math.hypot(dir.x, dir.z) || 1;
  p.rollDirX = dir.x / len;
  p.rollDirZ = dir.z / len;
  p.rollT = 0;

  // Cancel any in-progress swing (roll has defensive priority over attack recovery).
  p.attackT = -1;
  p.move = null;
  p.chargeT = -1;

  // Face the roll direction and play the tumble.
  p.facing = facingFromVelocity(a.x || worldDirToScreen(p.rollDirX, p.rollDirZ).x, a.z || worldDirToScreen(p.rollDirX, p.rollDirZ).z, p.facing);
  p.anim.setFacing(p.facing);
  p.anim.setRate(1); // run-gait rate is sticky — the tumble plays at clip speed
  p.anim.play("roll", { force: true });
  sfxRoll();
  return true;
}

/**
 * Advance an active roll. Drives the eased roll velocity through moveCircle,
 * IGNORING the input axis (direction is committed). i-frames cover only the
 * front ~ROLL_IFRAMES of the roll, granted by TOPPING UP the existing p.iframes
 * — the same guard hitPlayer already checks — so a roll and a damage-hit never
 * stack two independent invuln windows (the double-i-frame fix). The back half
 * still moves you but is hittable. Returns true while the roll owns the player.
 */
function updateRoll(dt: number, input: InputHandle): boolean {
  const p = state.player;
  const g = state.grid;
  if (!p || !g || p.rollT < 0) return false;

  const prevRollT = p.rollT;
  p.rollT += dt;

  // Roll body: apply eased velocity. After ROLL_DURATION we're in recovery
  // (rooted, vulnerable) until ROLL_DURATION + ROLL_RECOVERY, then done.
  if (p.rollT <= ROLL_DURATION) {
    const tau = p.rollT / ROLL_DURATION;
    const speed = ROLL_V0 * (1 - tau); // fast → slow
    const res = moveCircle(g, p.x, p.z, PLAYER_R, p.rollDirX * speed * dt, p.rollDirZ * speed * dt);
    p.x = res.x;
    p.z = res.z;

    // Rolling INTO a wall converts to a WALL-KICK rebound mid-tumble — sprint
    // at a wall, dodge, and the knight vaults straight off it. Free (the dodge
    // converts free mid-tumble); only during the roll body, and only when the
    // roll direction genuinely points at the wall we just hit.
    const wall = wallContact(g, p.x, p.z, PLAYER_R, WALL_CONTACT_PROBE);
    if (wall && p.rollDirX * wall.nx + p.rollDirZ * wall.nz < -0.5) {
      if (startWallLaunch("kick", wall, input)) return true;
    }

    // i-frames only for the front window — top up the shared guard so it never
    // stacks with a separate damage-i-frame window.
    if (p.rollT < ROLL_IFRAMES) {
      p.iframes = Math.max(p.iframes, ROLL_IFRAMES - p.rollT);
    }
    // A little dust as the tumble scuffs the floor, plus afterimages so the
    // tumble leaves a trail (distance-spawned ghosts, per the roll research).
    state.vfx?.dust(p.x, 0.05, p.z);
    spawnAura(dt, 0.08, false, 0.26, 0.35);
  }

  // The instant the roll body ends (before the recovery beat), stamp a landing
  // puff — the touchdown "squash" that sells the roll ending (research: a landing
  // dust puff reads the settle). Fires once, on the body→recovery boundary.
  if (prevRollT < ROLL_DURATION && p.rollT >= ROLL_DURATION) {
    state.vfx?.dust(p.x, 0.02, p.z);
    state.vfx?.dust(p.x, 0.04, p.z);
  }

  if (p.rollT >= ROLL_DURATION + ROLL_RECOVERY) {
    p.rollT = -1;
    p.anim.play("idle", { force: true });
  }

  syncActorMesh(p);
  return true;
}

// ── Wall moves (Mortal-Kombat-style specials off a wall) ───────────────────
// "Jump off the wall" adapted to a top-down grid: when pressed against a wall,
// wallContact() gives the outward normal and a short input launches a committed
// arc that carries a strike. All run on moveCircle + the melee timeline.

/** The wall normal the player is currently against, or null. Cached per frame. */
function currentWallNormal(): { nx: number; nz: number } | null {
  const p = state.player;
  const g = state.grid;
  if (!p || !g) return null;
  return wallContact(g, p.x, p.z, PLAYER_R, WALL_CONTACT_PROBE);
}

/**
 * Begin a launch off a wall (wall-kick or pounce). Commits the launch direction
 * (the wall normal, biased by input for the kick), and — for the kick — queues a
 * lunging light strike that lands as the hop peaks. FREE (no stamina): wall
 * tricks are always available in the momentum sandbox. Returns true if started.
 */
function startWallLaunch(kind: "kick" | "pounce", normal: { nx: number; nz: number }, input: InputHandle): boolean {
  const p = state.player;
  if (!p) return false;
  const move = kind === "kick" ? WALLKICK : POUNCE;

  // Launch direction: straight off the wall for a pounce; for a wall-kick, blend
  // the wall normal with any held input so you can angle the rebound.
  let dx = normal.nx;
  let dz = normal.nz;
  if (kind === "kick") {
    const a = input.axis();
    if (a.x !== 0 || a.z !== 0) {
      const wd = screenDirToWorld(a.x, a.z);
      // Only accept the input component that points AWAY from the wall (dot>0),
      // so you can steer along the launch but never back into the wall.
      const dot = wd.x * normal.nx + wd.z * normal.nz;
      if (dot > 0) {
        dx = normal.nx + wd.x;
        dz = normal.nz + wd.z;
      }
    }
  }
  const len = Math.hypot(dx, dz) || 1;
  p.wallMoveDirX = dx / len;
  p.wallMoveDirZ = dz / len;
  p.wallMoveKind = kind;
  p.wallMoveT = 0;
  p.wallMoveDur = kind === "kick" ? WALLKICK_DURATION : POUNCE_DURATION;
  p.wallMoveIfr = kind === "kick" ? WALLKICK_IFRAMES : POUNCE_IFRAMES;
  p.wallMoveDist = kind === "kick" ? WALLKICK_DISTANCE : POUNCE_DISTANCE;

  // Cancel any swing/roll/charge — the launch owns the player now.
  p.attackT = -1;
  p.move = null;
  p.chargeT = -1;
  p.rollT = -1;
  p.didHit = false;

  // Face the launch and play the tumble clip (reuse "roll" art for the airborne hop).
  const s = worldDirToScreen(p.wallMoveDirX, p.wallMoveDirZ);
  p.facing = facingFromVelocity(s.x, s.z, p.facing);
  p.anim.setFacing(p.facing);
  p.anim.setRate(1.3); // the 4-frame tumble squeezed into the shorter launch arc
  p.anim.play("roll", { force: true });
  sfxRoll();
  // Kick-off juice: a burst of dust at the wall plus a nudge of screen shake,
  // so the launch reads as an EVENT, not just another roll frame.
  for (let i = 0; i < 4; i++) {
    state.vfx?.dust(p.x - p.wallMoveDirX * (0.2 + i * 0.12), 0.08 + i * 0.05, p.z - p.wallMoveDirZ * (0.2 + i * 0.12));
  }
  state.shakeT = Math.max(state.shakeT, 0.12);
  return true;
}

/**
 * Advance an active wall launch. Eased fast→slow displacement (ease-out, matching
 * the roll), front-loaded i-frames topped into the shared p.iframes guard. A KICK
 * lands a lunging light strike once past its windup; a POUNCE detonates a radial
 * AoE on landing. Returns true while the launch owns the player.
 */
function updateWallLaunch(dt: number): boolean {
  const p = state.player;
  const g = state.grid;
  if (!p || !g || p.wallMoveT < 0) return false;

  const move = p.wallMoveKind === "pounce" ? POUNCE : WALLKICK;
  const v0 = (2 * p.wallMoveDist) / p.wallMoveDur;
  const prevT = p.wallMoveT;
  p.wallMoveT += dt;

  // Eased displacement over the arc body.
  if (prevT < p.wallMoveDur) {
    const tau = Math.min(1, prevT / p.wallMoveDur);
    const speed = v0 * (1 - tau);
    const res = moveCircle(g, p.x, p.z, PLAYER_R, p.wallMoveDirX * speed * dt, p.wallMoveDirZ * speed * dt);
    p.x = res.x;
    p.z = res.z;
    if (prevT < p.wallMoveIfr) p.iframes = Math.max(p.iframes, p.wallMoveIfr - prevT);
    state.vfx?.dust(p.x, 0.05, p.z);
    // Wall tricks trail GOLD ghosts — the flashy moves earn the hot aura.
    spawnAura(dt, 0.07, true, 0.28, 0.4);
  }

  // A wall-KICK carries a lunging light strike: land it once past the move's windup.
  if (p.wallMoveKind === "kick" && !p.didHit && p.wallMoveT >= move.windup) {
    p.didHit = true;
    resolvePlayerAttack({ damageMul: move.damageMul, arcMul: move.arcMul, rangeMul: move.rangeMul, knockbackMul: move.knockbackMul, hitstopMul: move.hitstopMul });
    const w = WEAPONS[activeWeapon().id];
    state.vfx?.slash(p.x + p.wallMoveDirX * 0.5, 0.6, p.z + p.wallMoveDirZ * 0.5, p.facing, w.slashColor ?? 0xdfe7f2);
  }

  // Landing: end the arc. A POUNCE detonates a radial slam at the landing spot.
  if (p.wallMoveT >= p.wallMoveDur) {
    if (p.wallMoveKind === "pounce" && !p.didHit) {
      p.didHit = true;
      pounceSlam(move);
    }
    p.wallMoveT = -1;
    p.wallMoveKind = null;
    p.anim.play("idle", { force: true });
    // Landing puff (research: a squash puff sells the touchdown).
    state.vfx?.dust(p.x, 0.02, p.z);
    state.vfx?.dust(p.x, 0.02, p.z);
  }

  syncActorMesh(p);
  return true;
}

/** A pounce landing: a radial AoE that hits every zombie inside POUNCE_AOE tiles. */
function pounceSlam(move: MoveTiming): void {
  const p = state.player;
  if (!p) return;
  const w = WEAPONS[activeWeapon().id];
  const dmg = playerDamage(w.damage * move.damageMul);
  const push = 0.6 * move.knockbackMul;
  for (const z of state.zombies) {
    if (z.mode === "dead") continue;
    const dx = z.x - p.x;
    const dz = z.z - p.z;
    if (dx * dx + dz * dz > POUNCE_AOE * POUNCE_AOE) continue;
    damageZombie(z, dmg, dx, dz, push);
    applyCardOnHit(z);
  }
  if (state.zombies.some((z) => z.mode !== "dead")) wearActiveWeapon();
  // Marble materials fire their big slam emitter here (shards / slick / boulder).
  materialSlam();
  // Impact juice: a shockwave of dust + a hard shake.
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    state.vfx?.dust(p.x + Math.cos(ang) * POUNCE_AOE * 0.6, 0.05, p.z + Math.sin(ang) * POUNCE_AOE * 0.6);
  }
  state.shakeT = Math.max(state.shakeT, 0.3);
  state.hitstopT = Math.max(state.hitstopT, 0.06);
  sfxHeavy();
}

function rangedSfx(id: string): void {
  if (id === "gun") sfxGun();
  else if (id === "bow") sfxBow();
  else sfxFlame();
}

/**
 * CURVED WALLS — bank the player leg→leg through any auto-detected maze corner
 * (collision.computeArcCorners), the deflector move applied to the whole maze.
 * A fast entry along one open leg sweeps out the other with its speed intact;
 * a slow walk just rounds the corner (the wedge is only a visual there). Ticks
 * each corner's re-bank lockout so hugging one doesn't machine-gun the redirect.
 */
function bankArcCorners(dt: number): void {
  const p = state.player;
  if (!p) return;
  for (const arc of state.arcCorners) {
    if (arc.cooldownT > 0) {
      arc.cooldownT = Math.max(0, arc.cooldownT - dt);
      continue;
    }
    if (p.momSpeed < ARC_MIN_SPEED) continue;
    const dx = p.x - arc.cx;
    const dz = p.z - arc.cz;
    if (dx * dx + dz * dz > ARC_BANK_RADIUS * ARC_BANK_RADIUS) continue;
    // Which OPEN leg did we come in along? Exit along the OTHER, speed intact.
    const inFrom1 = p.momX * -arc.d1x + p.momZ * -arc.d1z;
    const inFrom2 = p.momX * -arc.d2x + p.momZ * -arc.d2z;
    if (inFrom1 < 0.3 && inFrom2 < 0.3) continue; // grazing past, not cornering
    if (inFrom1 >= inFrom2) {
      p.momX = arc.d2x;
      p.momZ = arc.d2z;
    } else {
      p.momX = arc.d1x;
      p.momZ = arc.d1z;
    }
    p.momSpeed = Math.min(PINBALL_MAX_SPEED, p.momSpeed * ARC_BOOST);
    arc.cooldownT = ARC_COOLDOWN;
    arc.hitT = 0;
    onPartTrigger(); // ticks the combo + frenzy chain, like a deflector
    state.vfx?.sparks(arc.cx, 0.3, arc.cz, p.momX, p.momZ, 6);
    sfxRoll();
    break; // one bank per frame — you can't hit two corners at once
  }
}

/**
 * If the wall just slammed (along the blocked axes, travelling (dirX, dirZ))
 * is a CRACKED secret band, smash through it. Probes a hair past the body on
 * each blocked axis — after moveCircle's clamp we sit flush against the tile
 * that stopped us. Returns true if masonry actually broke (the caller then
 * barrels THROUGH instead of reflecting).
 */
function trySmashAhead(g: Grid, x: number, z: number, dirX: number, dirZ: number, blockedX: boolean, blockedZ: boolean): boolean {
  if (blockedX) {
    const t = worldToTile(g, x + Math.sign(dirX) * (PLAYER_R + 0.12), z);
    if (at(g, t.i, t.j) === T_CRACKED && smashSecretAt(t.i, t.j)) return true;
  }
  if (blockedZ) {
    const t = worldToTile(g, x, z + Math.sign(dirZ) * (PLAYER_R + 0.12));
    if (at(g, t.i, t.j) === T_CRACKED && smashSecretAt(t.i, t.j)) return true;
  }
  return false;
}

/** Same probe as trySmashAhead, but asking only "was that a crack?" — the hint. */
function crackedAhead(g: Grid, x: number, z: number, dirX: number, dirZ: number, blockedX: boolean, blockedZ: boolean): boolean {
  if (blockedX) {
    const t = worldToTile(g, x + Math.sign(dirX) * (PLAYER_R + 0.12), z);
    if (at(g, t.i, t.j) === T_CRACKED) return true;
  }
  if (blockedZ) {
    const t = worldToTile(g, x, z + Math.sign(dirZ) * (PLAYER_R + 0.12));
    if (at(g, t.i, t.j) === T_CRACKED) return true;
  }
  return false;
}

/**
 * At TERMINAL speed (≥ WALL_BREAK_SPEED) an ordinary wall gives too — but only
 * where there's a corridor on the far side (isBreakableWall), so you punch a
 * shortcut, never a hole into dead rock or through the outer shell. Same probe
 * as trySmashAhead. Returns true if a wall broke (caller barrels through).
 */
function trySmashWallAhead(g: Grid, x: number, z: number, dirX: number, dirZ: number, blockedX: boolean, blockedZ: boolean): boolean {
  // Break the WHOLE band, not just its near face — bands are 2 tiles thick, so
  // opening one tile would leave the knight embedded in the wall he just broke.
  const punch = (i: number, j: number, ddx: number, ddz: number): boolean => {
    const depth = wallRunDepth(g, i, j, ddx, ddz);
    if (depth <= 0) return false;
    let broke = false;
    for (let d = 0; d < depth; d++) {
      if (smashWallAt(i + Math.sign(ddx) * d, j + Math.sign(ddz) * d)) broke = true;
    }
    return broke;
  };
  if (blockedX) {
    const ddx = Math.sign(dirX);
    const t = worldToTile(g, x + ddx * (PLAYER_R + 0.12), z);
    if (punch(t.i, t.j, ddx, 0)) return true;
  }
  if (blockedZ) {
    const ddz = Math.sign(dirZ);
    const t = worldToTile(g, x, z + ddz * (PLAYER_R + 0.12));
    if (punch(t.i, t.j, 0, ddz)) return true;
  }
  return false;
}

// ── Trapdoor hatch drop ─────────────────────────────────────────────────────
// The beat the teleport was missing: the hatch BANGS open, the knight is drawn
// onto it and drops through the floor, and only then does the rail take over.
// It owns the player for its whole half-second so the door animation is
// something you watch happen to you — you can't step off the hatch mid-swing.

/** The hatch gives way: lock the player in, start the door animation's beat. */
function startDrop(x: number, z: number): void {
  const p = state.player;
  if (!p || p.dropT >= 0 || p.rideT >= 0) return;
  p.dropT = 0;
  p.dropX = x;
  p.dropZ = z;
  p.momSpeed = 0; // the hatch owns the physics now
  p.attackT = -1;
  p.move = null;
  p.chargeT = -1;
  p.rollT = -1;
  p.wallMoveT = -1;
  p.iframes = Math.max(p.iframes, TRAPDOOR_DROP);
  p.anim.setRate(1.4);
  p.anim.play("ball", { force: true });
  showToast("🎢 TRAPDOOR!", "the floor gives way — hold on");
  sfxTrapdoor();
}

/**
 * Advance the hatch drop. Two beats: the door swings (you're reeled onto the
 * centre, feet scrabbling) then the floor is gone (you sink out of sight).
 * Handing off to startRide at the bottom is what makes the trapdoor the single
 * teleport in the game — everything else stays where it stands.
 */
function updateDrop(dt: number): boolean {
  const p = state.player;
  if (!p || p.dropT < 0) return false;
  p.dropT += dt;
  const t = p.dropT;

  // Beat 1 — reeled onto the hatch centre while the door is still swinging.
  const pull = Math.min(1, dt * 9);
  p.x += (p.dropX - p.x) * pull;
  p.z += (p.dropZ - p.z) * pull;
  syncActorMesh(p);

  // Beat 2 — the floor is open: sink, accelerating, until the rail catches you.
  // syncActorMesh pins y=0, so the sink is applied after it (as the ride does).
  const fall = Math.max(0, (t - TRAPDOOR_OPEN) / (TRAPDOOR_DROP - TRAPDOOR_OPEN));
  p.sprite.mesh.position.y = -TRAPDOOR_DROP_DEPTH * fall * fall;
  if (fall > 0) {
    if (Math.random() < 20 * dt) state.vfx?.dust(p.x + (Math.random() - 0.5) * 0.6, 0.1, p.z + (Math.random() - 0.5) * 0.6);
  } else if (Math.random() < 8 * dt) {
    state.vfx?.sparks(p.dropX, 0.15, p.dropZ, 0, 0, 2); // the hinge complains
  }

  if (t >= TRAPDOOR_DROP) {
    p.dropT = -1;
    startRide(); // straight into the rail — no frame standing on an open hole
  }
  return true;
}

// ── Trapdoor rollercoaster (Wave D) ─────────────────────────────────────────
// A trapdoor doesn't teleport — it RIDES: a Catmull-Rom spline flown OVER the
// maze walls (so no collision question exists), control locked, i-frames on,
// exiting as a full-speed momentum launch somewhere far. All state mutation
// happens at the endpoints, so it can never desync combat.

/** Catmull-Rom interpolation across the ride's waypoint list at u ∈ 0..1. */
function ridePoint(pts: Array<{ x: number; z: number }>, u: number): { x: number; z: number } {
  const n = pts.length - 1;
  const t = Math.min(0.9999, Math.max(0, u)) * n;
  const k = Math.floor(t);
  const f = t - k;
  const p0 = pts[Math.max(0, k - 1)];
  const p1 = pts[k];
  const p2 = pts[Math.min(n, k + 1)];
  const p3 = pts[Math.min(n, k + 2)];
  const cr = (a: number, b: number, c: number, d: number): number =>
    0.5 * (2 * b + (c - a) * f + (2 * a - 5 * b + 4 * c - d) * f * f + (3 * b - a - 3 * c + d) * f * f * f);
  return { x: cr(p0.x, p1.x, p2.x, p3.x), z: cr(p0.z, p1.z, p2.z, p3.z) };
}

/** Pick where the coaster drops you: far tiles preferred, with a taste for trouble/treasure. */
function pickRideExit(g: Grid): { x: number; z: number } {
  const p = state.player!;
  let best: { x: number; z: number } | null = null;
  let bestScore = -1;
  for (let n = 0; n < 40; n++) {
    const i = 1 + Math.floor(Math.random() * (g.w - 2));
    const j = 1 + Math.floor(Math.random() * (g.h - 2));
    if (!isWalkable(g, i, j)) continue;
    const c = tileCenter(g, i, j);
    // Never set down on another hatch: a ride that ends on a trapdoor starts
    // the next one, and the knight ping-pongs across the floor with no way to
    // take control back. The one teleport must always hand you back the wheel.
    if (state.pinballParts.some((q) => q.kind === "trapdoor" && Math.hypot(q.x - c.x, q.z - c.z) < 2)) continue;
    let score = Math.hypot(c.x - p.x, c.z - p.z); // farther is better
    // A pinch of bias: landing near loot (fun) or near the stairs (progress).
    if (state.groundItems.some((it) => Math.hypot(it.x - c.x, it.z - c.z) < 3)) score += 8;
    if (state.stairs) {
      const sc = tileCenter(g, state.stairs.i, state.stairs.j);
      if (Math.hypot(sc.x - c.x, sc.z - c.z) < 5) score += 6;
    }
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best ?? { x: p.x, z: p.z };
}

/** The hole has swallowed you: build the spline and hand the player to the rail. */
function startRide(): void {
  const p = state.player;
  const g = state.grid;
  if (!p || !g || p.rideT >= 0) return;
  const exit = pickRideExit(g);
  // Two mid waypoints bowed off the straight line make it a RIDE, not a zip.
  const dx = exit.x - p.x;
  const dz = exit.z - p.z;
  const len = Math.hypot(dx, dz) || 1;
  const px = -dz / len; // perpendicular
  const pz = dx / len;
  const bow1 = (Math.random() - 0.5) * Math.min(10, len * 0.6);
  const bow2 = (Math.random() - 0.5) * Math.min(10, len * 0.6);
  p.ridePts = [
    { x: p.x, z: p.z },
    { x: p.x + dx * 0.33 + px * bow1, z: p.z + dz * 0.33 + pz * bow1 },
    { x: p.x + dx * 0.66 + px * bow2, z: p.z + dz * 0.66 + pz * bow2 },
    exit,
  ];
  p.rideT = 0;
  p.rideDur = Math.min(TRAPDOOR_RIDE_MAX, Math.max(TRAPDOOR_RIDE_MIN, len / TRAPDOOR_RIDE_SPEED));
  p.momSpeed = 0; // the rail owns the physics now
  p.attackT = -1;
  p.move = null;
  p.chargeT = -1;
  p.rollT = -1;
  p.wallMoveT = -1;
  p.anim.setRate(1.4);
  // The toast/sfx already fired when the hatch opened (startDrop) — the ride is
  // the second half of one event, not a new one.
  state.shakeT = Math.max(state.shakeT, 0.2);
}

/**
 * Advance an active coaster ride. Owns the player completely: position comes
 * off the spline, height arcs over the walls, i-frames the whole way. Landing
 * hands the flight speed straight to the pinball system — the coaster IS a
 * launcher.
 */
function updateRide(dt: number): boolean {
  const p = state.player;
  if (!p || p.rideT < 0) return false;
  p.rideT += dt;
  const u = Math.min(1, p.rideT / p.rideDur);
  const pos = ridePoint(p.ridePts, u);
  const ahead = ridePoint(p.ridePts, Math.min(1, u + 0.03));
  p.x = pos.x;
  p.z = pos.z;
  p.iframes = Math.max(p.iframes, 0.1);
  // Face along the rail; trail gold ghosts + rail sparks.
  const s = worldDirToScreen(ahead.x - pos.x, ahead.z - pos.z);
  if (s.x !== 0 || s.z !== 0) {
    p.facing = facingFromVelocity(s.x, s.z, p.facing);
    p.anim.setFacing(p.facing);
  }
  spawnAura(dt, 0.05, true, 0.3, 0.5);
  if (Math.random() < 14 * dt) state.vfx?.sparks(p.x, 0.4, p.z, 0, 0, 3);

  syncActorMesh(p);
  // FLY over the walls: the arc that makes it a coaster. syncActorMesh pins
  // y=0; lift after, like the ghosts do.
  // The rail picks you up UNDER the floor (where the hatch drop left you) and
  // hauls you out over the first TRAPDOOR_RISE of the ride, so the hand-off
  // from drop to ride is continuous instead of a pop back to floor level.
  const h = Math.sin(Math.PI * u) * TRAPDOOR_HEIGHT;
  const under = Math.max(0, 1 - u / TRAPDOOR_RISE);
  const rideY = h - TRAPDOOR_DROP_DEPTH * under * under;
  p.sprite.mesh.position.y = rideY;
  // Same shadow fix as the ramp hop: the blob is a child of the sprite, so
  // without this it flies the rollercoaster too. Clamped at 0 because while the
  // rail is still hauling you out from under the floor the elevation is
  // negative, and a shadow pushed UP through the floor reads worse than none.
  p.sprite.setElevation(Math.max(0, rideY));

  if (u >= 1) {
    p.rideT = -1;
    // Landing = a launch: the rail hands its speed to the pinball machine.
    // Take the exit heading from the LAST spline segment (sampling at u=1 and
    // u+0.03 both clamp to the endpoint → a zero vector that would bleed to a
    // standstill), falling back toward the final control leg if it's tiny.
    const tail = ridePoint(p.ridePts, 0.94);
    let dx = pos.x - tail.x;
    let dz = pos.z - tail.z;
    if (Math.hypot(dx, dz) < 1e-3 && p.ridePts.length >= 2) {
      const a = p.ridePts[p.ridePts.length - 2];
      const b = p.ridePts[p.ridePts.length - 1];
      dx = b.x - a.x;
      dz = b.z - a.z;
    }
    const dl = Math.hypot(dx, dz) || 1;
    p.ridePts = [];
    p.sprite.mesh.position.y = 0;
    p.sprite.setElevation(0);
    p.momX = dx / dl;
    p.momZ = dz / dl;
    p.momSpeed = TRAPDOOR_EXIT_SPEED;
    p.ramT = 0;
    // You land at launch speed and skid a long way — arm EVERY hatch's lockout,
    // not just the one you fell through, so the skid can't be swallowed by a
    // second trapdoor before you've had a single frame of control.
    for (const q of state.pinballParts) if (q.kind === "trapdoor") q.cooldownT = Math.max(q.cooldownT, TRAPDOOR_COOLDOWN);
    onPartTrigger();
    for (let k = 0; k < 3; k++) state.vfx?.dust(p.x + (Math.random() - 0.5) * 0.5, 0.04, p.z + (Math.random() - 0.5) * 0.5);
    state.shakeT = Math.max(state.shakeT, 0.25);
    sfxHeavy();
  }
  return true;
}

// ── A2 Ramp hop ─────────────────────────────────────────────────────────────
// A ramp doesn't just floor your speed — it FLINGS you into a short ballistic
// arc that clears wall bands (collision bypassed while airborne, like a smaller
// trapdoor ride) and sets down on the far floor, handing the speed to the
// pinball machine on landing (so you bounce if you set down against a wall).

/**
 * Begin a ramp hop along (dirX,dirZ). Scans for the FARTHEST walkable landing in
 * [RAMP_HOP_MIN, RAMP_HOP_MAX] tiles ahead so the arc reaches over a 2-thick
 * wall band and lands on the corridor beyond. If nothing walkable is in range
 * (the ramp fires into deep rock), we skip the hop and keep the flat dash the
 * caller already set. No-ops if a hop/ride already owns the player.
 */
function startRampHop(dirX: number, dirZ: number, speed: number): void {
  const p = state.player;
  const g = state.grid;
  if (!p || !g || p.hopT >= 0 || p.rideT >= 0) return;
  const dl = Math.hypot(dirX, dirZ) || 1;
  const ux = dirX / dl;
  const uz = dirZ / dl;
  // Prefer a landing on the FAR side of a wall — that's a vault, the whole
  // point of the arc. Scanning far→near and taking the first walkable would
  // otherwise just pick the end of an open lane and never cross anything.
  let land: { x: number; z: number } | null = null;
  let vaultLand: { x: number; z: number } | null = null;
  let crossedWall = false;
  for (let d = RAMP_HOP_MIN; d <= RAMP_HOP_MAX; d += 0.25) {
    const t = worldToTile(g, p.x + ux * d, p.z + uz * d);
    if (!isWalkable(g, t.i, t.j)) {
      crossedWall = true; // a band lies between us and anything further out
      continue;
    }
    const c = tileCenter(g, t.i, t.j); // snap to the centre so we never set down in a wall corner
    land = { x: c.x, z: c.z }; // farthest walkable wins, as before
    if (crossedWall && !vaultLand) vaultLand = { x: c.x, z: c.z }; // first tile past the band
  }
  land = vaultLand ?? land;
  if (!land) {
    // Nowhere clear to land: the flat dash stands, but say so — a silent no-op
    // reads as the ramp being broken.
    showPickupNote("⛰️ NO LANDING — the ramp just shoves you");
    return;
  }
  p.hopStartX = p.x;
  p.hopStartZ = p.z;
  p.hopLandX = land.x;
  p.hopLandZ = land.z;
  p.hopDirX = ux;
  p.hopDirZ = uz;
  p.hopSpeed = Math.max(speed, RAMP_SPEED);
  p.hopDur = Math.max(0.22, Math.hypot(land.x - p.x, land.z - p.z) / RAMP_HOP_SPEED);
  p.hopT = 0;
  // The launch owns the player — cancel any swing/roll/charge, like the ride.
  p.attackT = -1;
  p.move = null;
  p.chargeT = -1;
  p.rollT = -1;
  p.anim.setRate(1.3);
  p.anim.play("roll", { force: true }); // reuse the tumble clip for the airborne hop
  sfxRoll();
  state.shakeT = Math.max(state.shakeT, 0.14);
}

/**
 * Advance an active ramp hop. Owns the player: position lerps straight from
 * launch to landing (walls bypassed), height arcs on a sine, i-frames span the
 * flight. Landing feeds the speed into the pinball system along the hop heading,
 * so the knight carries on — and bounces if the landing sat against a wall.
 */
function updateHop(dt: number): boolean {
  const p = state.player;
  if (!p || p.hopT < 0) return false;
  p.hopT += dt;
  const u = Math.min(1, p.hopT / p.hopDur);
  p.x = p.hopStartX + (p.hopLandX - p.hopStartX) * u;
  p.z = p.hopStartZ + (p.hopLandZ - p.hopStartZ) * u;
  p.iframes = Math.max(p.iframes, 0.08);
  const s = worldDirToScreen(p.hopDirX, p.hopDirZ);
  if (s.x !== 0 || s.z !== 0) {
    p.facing = facingFromVelocity(s.x, s.z, p.facing);
    p.anim.setFacing(p.facing);
  }
  syncActorMesh(p); // pins y=0; lift after, like the ride
  const hgt = Math.sin(Math.PI * u) * RAMP_HOP_HEIGHT;
  p.sprite.mesh.position.y = hgt;
  // Pin the contact shadow to the floor. Without this the blob — a child of the
  // sprite mesh — rides up with the knight, killing the only cue that reads as
  // height in an isometric view.
  p.sprite.setElevation(hgt);
  if (Math.random() < 12 * dt) state.vfx?.sparks(p.x, 0.3 + hgt, p.z, 0, 0, 2);

  if (u >= 1) {
    p.hopT = -1;
    p.sprite.mesh.position.y = 0;
    p.sprite.setElevation(0);
    // Land into pinball momentum along the launch heading — the physics carries
    // the speed onward and reflects it if we set down flush against a wall.
    p.momX = p.hopDirX;
    p.momZ = p.hopDirZ;
    p.momSpeed = Math.min(PINBALL_MAX_SPEED, p.hopSpeed);
    onPartTrigger();
    for (let k = 0; k < 4; k++) state.vfx?.dust(p.x + (Math.random() - 0.5) * 0.5, 0.04, p.z + (Math.random() - 0.5) * 0.5);
    state.shakeT = Math.max(state.shakeT, 0.16);
    sfxHeavy();
  }
  return true;
}

/**
 * Distance (world units) from (x,z) to the first non-walkable tile stepping out
 * along (dirX,dirZ), capped at LANE_PROBE_MAX. Used by the lane glide to find
 * how much corridor room is on each side so it can centre the ball.
 */
function wallClearance(g: Grid, x: number, z: number, dirX: number, dirZ: number): number {
  for (let d = PLAYER_R; d <= LANE_PROBE_MAX; d += 0.12) {
    const t = worldToTile(g, x + dirX * d, z + dirZ * d);
    if (!isWalkable(g, t.i, t.j)) return d;
  }
  return LANE_PROBE_MAX;
}

/**
 * PINBALL PHYSICS — while p.momSpeed > 0 the knight carries real momentum and
 * bounces off walls instead of stopping. Owns the player (returns true) until
 * the momentum bleeds below PINBALL_EXIT_MULT·PLAYER_SPEED, then hands control
 * back. At FULL overcharge he's a BALL: faster, and he RAMS zombies on contact.
 * A dodge tap bails out instantly (handled in updatePlayer before this runs).
 */
function updatePinball(dt: number, input: InputHandle): boolean {
  const p = state.player;
  const g = state.grid;
  if (!p || !g || p.momSpeed <= 0) return false;

  // DEFLECTOR GRAB-THROW hold: a corner deflector caught the knight (see
  // pinball-collide.ts `deflector`). He's pinned to the rail for a wind-up
  // beat, untouchable, then HURLED along the stored exit leg. Owns the player
  // for the duration — no steering, collision or friction runs while held.
  if (p.grabT > 0) {
    p.grabT -= dt;
    p.x = p.grabX;
    p.z = p.grabZ;
    p.iframes = Math.max(p.iframes, 0.2);
    // Wind-up: a tight burst of sparks gathering onto the rail each frame.
    state.vfx?.sparks(p.grabX, 0.35, p.grabZ, 0, 0, 3);
    if (p.grabT <= 0) {
      // RELEASE — the throw. Launch hard along the exit leg with a spark burst,
      // a shove of shake and a spring twang.
      p.grabT = 0;
      p.momX = p.throwDirX;
      p.momZ = p.throwDirZ;
      p.momSpeed = p.throwSpeed;
      state.shakeT = Math.max(state.shakeT, 0.22);
      state.vfx?.sparks(p.x + p.momX * PLAYER_R, 0.35, p.z + p.momZ * PLAYER_R, p.momX, p.momZ, 16);
      sfxSpring();
    }
    syncActorMesh(p);
    return true;
  }

  // Part 2 — TEMPO ZONES. The 0→deep combo is three acts: Launch (accelerate),
  // Cruise (flow, ball form armed, gold aura), Frenzy (edge of control, faster
  // ball + screen FX). Each upward crossing fires ONE signal (toast + shake +
  // sting) so the player learns to feel the boundaries and aim for milestones.
  const zone = comboZone(p.bounceCombo);
  if (zone !== state.comboZone) {
    const order = { launch: 0, cruise: 1, frenzy: 2 } as const;
    if (order[zone] > order[state.comboZone]) {
      if (zone === "cruise") {
        p.overcharge = 1; // arm ball form the moment you reach the flow state
        showToast("🌀 CRUISE", `combo ×${p.bounceCombo} · in the flow`);
        state.shakeT = Math.max(state.shakeT, 0.16);
        sfxSpring();
      } else if (zone === "frenzy") {
        showToast("🔥 FRENZY", `combo ×${p.bounceCombo} · on the edge`);
        state.shakeT = Math.max(state.shakeT, 0.3);
        sfxBumper();
      }
    }
    state.comboZone = zone;
  }

  const isBall = p.overcharge >= 1;
  // Frenzy pushes the ball harder (FRENZY_BALL_SPEED_MULT vs BALL_SPEED_MULT).
  const speedMul = isBall ? (zone === "frenzy" ? FRENZY_BALL_SPEED_MULT : BALL_SPEED_MULT) : 1;

  // Overcharge keeps building WHILE bouncing — you're obviously moving fast, so
  // the ride itself charges toward ball form. Without this the first wall slam
  // launches pinball and starves the ground-sprint that was building overcharge,
  // making ball form effectively unreachable (caught by driving it).
  p.overcharge = Math.min(1, p.overcharge + dt / OVERCHARGE_TIME);

  // Steer: gently BEND the momentum direction (a nudge, not full control — it's
  // a physics roll, not a walk). A dash panel locks steering briefly.
  //
  // MARBLE MODE steers with the MOUSE: a marble is AIMED, not walked — the ride
  // bends toward the cursor. Falls back to WASD when there's no cursor (headless
  // / keyboard-only), so the old scheme still works.
  steerLockT = Math.max(0, steerLockT - dt);
  // Oil kills the steering (you're on a slick); turbo sharpens it. Water marble
  // is slippery — weak grip, so momentum dominates (materialSteerMult).
  const steerMul = (p.oilT > 0 ? OIL_STEER_FACTOR : p.turboT > 0 ? TURBO_STEER_MULT : 1) * materialSteerMult();
  let steerX = 0;
  let steerZ = 0;
  const cursor = input.aimScreen();
  const aim = cursor ? mouseAimDirection(p.x, p.z, cursor) : null;
  if (aim) {
    steerX = aim.x;
    steerZ = aim.z;
  } else {
    const a = input.axis();
    if (a.x !== 0 || a.z !== 0) {
      const wd = screenDirToWorld(a.x, a.z);
      const wl = Math.hypot(wd.x, wd.z) || 1;
      steerX = wd.x / wl;
      steerZ = wd.z / wl;
    }
  }
  if (steerLockT <= 0 && (steerX !== 0 || steerZ !== 0)) {
    p.momX += steerX * PINBALL_STEER * steerMul * dt;
    p.momZ += steerZ * PINBALL_STEER * steerMul * dt;
    const ml = Math.hypot(p.momX, p.momZ) || 1;
    p.momX /= ml;
    p.momZ /= ml;
  }

  // Advance and detect a wall hit: try the full step; if moveCircle clamps us
  // short of the intended landing spot, we hit something — REFLECT the momentum
  // about the wall normal (wallContact at the pre-move point gives it).
  const step = p.momSpeed * speedMul * dt;
  const wantX = p.x + p.momX * step;
  const wantZ = p.z + p.momZ * step;
  const res = moveCircle(g, p.x, p.z, materialPlayerR(), p.momX * step, p.momZ * step);
  const blockedX = Math.abs(res.x - wantX) > 1e-3;
  const blockedZ = Math.abs(res.z - wantZ) > 1e-3;
  p.x = res.x;
  p.z = res.z;

  // LANE GLIDE (rebuilt): while railing fast, actively CENTRE the ball in the
  // corridor cross-section instead of letting it scrape a wall. Measure the
  // clear distance to a wall on each perpendicular side and nudge toward the
  // midpoint, proportional to how off-centre you are. It still fires while you
  // gently steer (at reduced strength) so a nudge can't pin you to a wall — the
  // fix for "it just rides against the wall". Skipped in true open rooms (no
  // near wall on either perpendicular side within reach).
  if (steerLockT <= 0 && p.momSpeed > PLAYER_SPEED) {
    const alongX = Math.abs(p.momX) >= Math.abs(p.momZ);
    const perpX = alongX ? 0 : 1;
    const perpZ = alongX ? 1 : 0;
    const cp = wallClearance(g, p.x, p.z, perpX, perpZ); // room on the + side
    const cn = wallClearance(g, p.x, p.z, -perpX, -perpZ); // room on the − side
    // Only centre when at least one side has a wall within reach (a lane, not a
    // wide-open room where centring would fight the player's chosen line).
    const nearWall = cp < LANE_PROBE_MAX || cn < LANE_PROBE_MAX;
    const imbalance = cp - cn; // >0 → more room on + side, drift that way
    if (nearWall && Math.abs(imbalance) > 0.12) {
      const steering = steerX !== 0 || steerZ !== 0;
      const strength = steering ? 0.45 : 1;
      const dir = Math.sign(imbalance);
      const nudge = Math.min(Math.abs(imbalance) * 0.5, LANE_CENTER_PULL * materialLanePull() * dt) * strength;
      const r2 = moveCircle(g, p.x, p.z, PLAYER_R, perpX * dir * nudge, perpZ * dir * nudge);
      p.x = r2.x;
      p.z = r2.z;
    }
  }

  if (res.hitN) {
    // SLANT WALL: a shaped tile was struck — the collider pushed us off its
    // diagonal and handed back the exact face NORMAL. Reflect the momentum
    // about it (v − 2(v·n)n) for a true diagonal ricochet, guarded by v·n < 0
    // so we only bounce when moving INTO the face (no push-out jitter). A slant
    // is a single FLAT face — flat restitution only, NEVER the corner tier
    // (that would be an infinite speed farm). Slants are never cracked, so the
    // smash-through paths below don't apply.
    const nx = res.hitN.nx;
    const nz = res.hitN.nz;
    const vn = p.momX * nx + p.momZ * nz;
    if (vn < 0) {
      p.momX -= 2 * vn * nx;
      p.momZ -= 2 * vn * nz;
      const rest = materialFlatRestitution() ?? (p.springT > 0 ? SPRINGLEGS_RESTITUTION : PINBALL_WALL_RESTITUTION);
      p.momSpeed = Math.min(PINBALL_MAX_SPEED, p.momSpeed * rest);
      p.bounceCombo += 1;
      p.bounceComboT = comboWindow(p.bounceCombo);
      state.vfx?.sparks(p.x + nx * PLAYER_R, 0.35, p.z + nz * PLAYER_R, nx, nz, 6 + Math.min(10, p.bounceCombo * 2));
      state.shakeT = Math.max(state.shakeT, 0.1 + Math.min(0.12, p.bounceCombo * 0.02));
      state.hitstopT = Math.max(state.hitstopT, 0.02);
      emitMaterialOnBounce(nx, nz);
      sfxRoll();
    }
  } else if (blockedX || blockedZ) {
    // SECRET WALL: enough momentum landing on a CRACKED band shatters it — the
    // knight barrels straight through the new gap (no reflection), spending a
    // slice of speed on the masonry. Still a combo tick: smashing IS style.
    // Diamond marble punches through masonry at far lower speed (materialBreakSpeeds).
    const brk = materialBreakSpeeds();
    if (p.momSpeed >= brk.secret && trySmashAhead(g, p.x, p.z, p.momX, p.momZ, blockedX, blockedZ)) {
      p.momSpeed *= 0.85;
      p.bounceCombo += 1;
      p.bounceComboT = comboWindow(p.bounceCombo);
      syncActorMesh(p);
      return true;
    }
    // Bounced off a crack too slowly: nothing teaches that SPEED is the key
    // (there's no button and no weapon for it), so say it once per floor.
    if (p.momSpeed < brk.secret && !state.crackHintShown && crackedAhead(g, p.x, p.z, p.momX, p.momZ, blockedX, blockedZ)) {
      state.crackHintShown = true;
      showPickupNote("🧱 CRACKED WALL — hit it FASTER to break through");
    }
    // KOOL-AID: at terminal speed you punch through an ORDINARY wall into the
    // corridor behind it — your own shortcut. Costs a big slice of speed so it
    // can't chew a straight line across the whole floor.
    if (p.momSpeed >= brk.wall && trySmashWallAhead(g, p.x, p.z, p.momX, p.momZ, blockedX, blockedZ)) {
      p.momSpeed *= WALL_BREAK_SPEED_COST;
      p.bounceCombo += 1;
      p.bounceComboT = comboWindow(p.bounceCombo);
      syncActorMesh(p);
      return true;
    }
    // Axis-aligned reflection (grid walls are axis-aligned): flip the blocked
    // component. Clean pinball ricochet off a flat wall face.
    if (blockedX) p.momX = -p.momX;
    if (blockedZ) p.momZ = -p.momZ;
    // SKILL-GATED ACCELERATION: a FLAT wall bounce PRESERVES your speed
    // (restitution just under 1 — you can't farm two parallel walls forever),
    // but a CORNER hit (both axes blocked in the same impact — an aimed
    // diagonal slam into a pocket) MULTIPLIES it up plus a kick. Bumpers,
    // springs and ramps (handled in touchPinballParts) are the other
    // accelerators. Every bounce still ticks the combo chain.
    const corner = blockedX && blockedZ;
    // Spring Legs turns even flat walls into gainers — compound bouncing.
    // Marble materials override the flat restitution (diamond elastic, water slick).
    const flatRest = materialFlatRestitution() ?? (p.springT > 0 ? SPRINGLEGS_RESTITUTION : PINBALL_WALL_RESTITUTION);
    if (corner) {
      // CORNER gain, combo-shaped (Parts 1+3): the restitution + flat kick
      // TAPER with combo depth (comboCornerRestitution/Add), and the result is
      // capped by the logarithmic combo ceiling — but ONLY as a cap on the
      // GAIN. A corner never drags you below the speed you already carry (a
      // plunger/spring can launch you above the ceiling at combo 0; the ceiling
      // just limits what BOUNCING alone can earn), so the launch feel is intact.
      const gain = p.momSpeed * comboCornerRestitution(p.bounceCombo) + comboCornerAdd(p.bounceCombo) * materialCornerAddMult();
      p.momSpeed = Math.min(PINBALL_MAX_SPEED, Math.max(p.momSpeed, Math.min(gain, comboSpeedCeil(p.bounceCombo))));
    } else {
      p.momSpeed = Math.min(PINBALL_MAX_SPEED, p.momSpeed * flatRest);
    }
    p.bounceCombo += 1;
    p.bounceComboT = comboWindow(p.bounceCombo);
    // Bounce juice scales with the combo — a corner hit throws a bigger burst.
    const n = currentWallNormal();
    const sx = n ? n.nx : -p.momX;
    const sz = n ? n.nz : -p.momZ;
    state.vfx?.sparks(p.x + sx * PLAYER_R, 0.35, p.z + sz * PLAYER_R, sx, sz, (corner ? 14 : 6) + Math.min(10, p.bounceCombo * 2));
    state.shakeT = Math.max(state.shakeT, (corner ? 0.18 : 0.1) + Math.min(0.12, p.bounceCombo * 0.02));
    state.hitstopT = Math.max(state.hitstopT, corner ? 0.05 : 0.02);
    emitMaterialOnBounce(sx, sz);
    sfxRoll();
  }

  // Pinball PARTS: bumpers kick, springs launch, ramps floor your speed,
  // deflectors bank you around corners. The real accelerators of the machine.
  touchPinballParts(true, curSpeed, PINBALL_DEPS);
  // Curved walls: sweep momentum around every banked maze corner.
  bankArcCorners(dt);

  // Momentum bleeds ONLY when NOT bouncing (Sonic keeps its speed on a good
  // line) — very gently. Oil grease and Turbo Charge kill the bleed outright.
  // The combo lapses if you go too long without a wall.
  // Per-surface friction (Slice 4): an OPEN tile (room/junction) is a fast
  // highway that holds speed; a TIGHT corridor/pocket bleeds it for control.
  const tile = worldToTile(g, p.x, p.z);
  let openN = 0;
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    if (isWalkable(g, tile.i + di, tile.j + dj)) openN++;
  }
  const surfMul = openN >= 3 ? FRICTION_OPEN : openN === 2 ? FRICTION_CORRIDOR : FRICTION_TIGHT;
  // Part 5 — deep combos add a gentle global grip (comboFrictionMul), so a long
  // chain bleeds a little faster in open rooms and is nudged back onto the
  // tight machine route where its bounces belong. Oil/Turbo still zero it out.
  // Marble materials scale the bleed: water glides (near-zero), stone drags more.
  const friction = p.oilT > 0 || p.turboT > 0 ? 0 : PINBALL_FRICTION * surfMul * comboFrictionMul(p.bounceCombo) * materialFrictionMult();
  p.momSpeed = Math.max(0, p.momSpeed - friction * dt);
  // Stone tops out at a lower speed ceiling than the default.
  p.momSpeed = Math.min(p.momSpeed, materialMaxSpeed());
  p.bounceComboT = Math.max(0, p.bounceComboT - dt);
  if (p.bounceComboT <= 0) {
    p.bounceCombo = 0;
    state.partComboHits = 0;
    state.frenzyPaid = false;
  }

  // Ball form rams the horde: anything the ball touches gets smashed aside.
  // IRON CORE makes the whole ride a ram — any momentum, triple damage.
  p.ramT = Math.max(0, p.ramT - dt);
  const ramming = isBall || p.ironT > 0;
  if (ramming && p.ramT <= 0) {
    const w = WEAPONS[activeWeapon().id];
    const dmg = playerDamage(Math.max(2, w.damage * 1.5) * (p.ironT > 0 ? IRONCORE_RAM_MULT : 1));
    // Stone shoves hard; water flows through with barely a nudge.
    const ramKb = materialRamKnockback();
    let hit = false;
    for (const z of state.zombies) {
      if (z.mode === "dead") continue;
      const dx = z.x - p.x;
      const dz = z.z - p.z;
      if (dx * dx + dz * dz > (PLAYER_R + ZOMBIE_R + 0.15) * (PLAYER_R + ZOMBIE_R + 0.15)) continue;
      damageZombie(z, dmg, p.momX, p.momZ, ramKb);
      applyCardOnHit(z);
      hit = true;
    }
    if (hit) {
      p.ramT = BALL_RAM_COOLDOWN;
      state.shakeT = Math.max(state.shakeT, 0.18);
    }
  }

  // i-frames: the ball is a hurtling projectile — untouchable. Pinball proper
  // (not yet a ball) gets brief top-ups so a bounce doesn't dump you into a bite.
  p.iframes = Math.max(p.iframes, isBall ? 0.2 : 0.08);

  // Aura + facing: gold ghosts, face the travel direction, spin the ball clip.
  // Aura runs cool blue in the Launch act, gold from Cruise onward — the
  // colour shift IS the zone signal you carry the whole ride.
  spawnAura(dt, isBall ? 0.05 : 0.07, zone !== "launch", 0.3, 0.45);
  const s = worldDirToScreen(p.momX, p.momZ);
  p.facing = facingFromVelocity(s.x, s.z, p.facing);
  p.anim.setFacing(p.facing);
  if (isBall) {
    p.anim.setRate(1 + p.momSpeed * 0.1);
    p.anim.play("ball");
  } else {
    p.anim.setRate(1.4);
    p.anim.play("roll");
  }
  state.vfx?.dust(p.x, 0.05, p.z);

  // Exit only when the momentum has genuinely bled off. (Overcharge no longer
  // gates the ride — bumpers/springs/ramps can launch momentum from a cold
  // start, so the machine works without spooling first. Overcharge is purely
  // the BALL-form gate now.)
  if (p.momSpeed < PLAYER_SPEED * PINBALL_EXIT_MULT) {
    p.momSpeed = 0;
    p.grabT = 0; // never leave a grab hanging when the ride ends
    p.bounceCombo = 0;
    p.bounceComboT = 0;
    state.partComboHits = 0;
    state.frenzyPaid = false;
    p.overcharge = Math.min(p.overcharge, 0.999); // drop out of ball form
    p.anim.setRate(1);
    p.anim.play("idle", { force: true });
  }

  syncActorMesh(p);
  return true;
}

/**
 * A WORLD ground aim direction → the 4-way sprite facing that best matches it.
 * The aim is converted to SCREEN axes first (worldDirToScreen) because the art's
 * facings are screen-relative — "E" is screen-right, "S" is screen-down. Ties
 * break toward the vertical (N/S) axis, which reads better, matching
 * facingFromVelocity.
 */
function facingFromAim(wx: number, wz: number): Facing {
  const s = worldDirToScreen(wx, wz);
  if (Math.abs(s.z) >= Math.abs(s.x)) return s.z > 0 ? "S" : "N";
  return s.x > 0 ? "E" : "W";
}

/**
 * The current launch line as a unit WORLD direction. Steering happens in SCREEN
 * space (so ←/→ rotate the line the way the player sees it on the iso floor),
 * then converts back to world.
 */
function plungerDir(): { x: number; z: number } {
  const s = worldDirToScreen(state.plungerBaseX, state.plungerBaseZ);
  const base = Math.atan2(s.z, s.x);
  const ang = base + state.plungerAim;
  const w = screenDirToWorld(Math.cos(ang), Math.sin(ang));
  const l = Math.hypot(w.x, w.z) || 1;
  return { x: w.x / l, z: w.z / l };
}

/**
 * THE PLUNGER — a floor opens PARKED in the launch chute. Hold the dodge key
 * (Space / right-click) to pull the plunger back: power fills over
 * PLUNGER_CHARGE_TIME. ←/→ steer the launch line ±PLUNGER_AIM_MAX off the base
 * lane. Release to FIRE — launch speed scales with the pull, and the skill shot
 * arms the instant the ball is away. Owns the player (returns true) until fired.
 */
export function updatePlunger(dt: number, input: InputHandle): boolean {
  const p = state.player;
  if (!p || !state.plungerArmed) return false;

  // Safe in the chute — no cheap hit before the ball is even in play.
  p.iframes = Math.max(p.iframes, dt + 0.05);

  // Drain any queued dodge TAP so releasing the plunger (key up) can't leak
  // straight into a roll the instant control is handed back.
  input.consumeDodge();

  // Steer the launch line while parked — whether or not you're pulling yet.
  const a = input.axis();
  if (a.x !== 0) {
    state.plungerAim = Math.max(-PLUNGER_AIM_MAX, Math.min(PLUNGER_AIM_MAX, state.plungerAim + a.x * PLUNGER_AIM_RATE * dt));
  }

  // Keep the parked knight facing down the current (steered) launch line, and
  // publish the live launch direction for the visible plunger rig to orient by.
  const dir = plungerDir();
  state.plungerDirX = dir.x;
  state.plungerDirZ = dir.z;
  p.facing = facingFromAim(dir.x, dir.z);
  p.anim.setFacing(p.facing);

  if (input.dodgeHeld()) {
    state.plungerCharging = true;
    state.plungerPower = Math.min(1, state.plungerPower + dt / PLUNGER_CHARGE_TIME);
    syncActorMesh(p);
    return true;
  }

  // Released after a real pull → FIRE the knight into play.
  if (state.plungerCharging && state.plungerPower > 0) {
    p.momX = dir.x;
    p.momZ = dir.z;
    p.momSpeed = PLUNGER_MIN_SPEED + (PLUNGER_SPEED - PLUNGER_MIN_SPEED) * state.plungerPower;
    p.ramT = 0;
    if (state.plungerSkill) armSkillShot(state.plungerSkill);
    sfxSpring();
    state.shakeT = Math.max(state.shakeT, 0.14 + 0.22 * state.plungerPower);
    state.vfx?.sparks(p.x, 0.4, p.z, -dir.x, -dir.z, 6);
    state.plungerArmed = false;
    state.plungerCharging = false;
    state.plungerPower = 0;
    return true;
  }

  // Parked, not yet pulled — hold position and wait for the player.
  syncActorMesh(p);
  return true;
}

export function updatePlayer(dt: number, input: InputHandle): void {
  const p = state.player;
  const g = state.grid;
  if (!p || !g || p.hp <= 0) return;

  p.cooldown = Math.max(0, p.cooldown - dt);
  p.iframes = Math.max(0, p.iframes - dt);
  p.oilT = Math.max(0, p.oilT - dt);
  p.webbedT = Math.max(0, p.webbedT - dt);
  updateFlash(p, dt);
  updateBuffTells(dt); // every timed buff has a look, not just a HUD tile

  // ── Plunger ── the floor opens parked in the launch chute; the pull/release
  // owns the player until the ball is fired into play.
  if (updatePlunger(dt, input)) return;

  // ── Trapdoor ── the hatch owns the player while the door swings and you
  // fall through, then the rail owns them for the whole ride.
  if (updateDrop(dt)) return;
  if (updateRide(dt)) return;

  // ── Ramp hop (A2) ── the airborne arc off a ramp owns the player mid-flight,
  // flying over walls; on landing it hands speed to the pinball block below.
  if (updateHop(dt)) return;

  // ── Wall launch (wall-kick / pounce) ── owns the player while airborne.
  if (updateWallLaunch(dt)) return;

  // ── Pinball ── while momentum is live the knight bounces off walls and owns
  // the player. A dodge tap BAILS OUT of it (kill the momentum, then fall
  // through so the same tap can start a roll off the exit).
  if (p.momSpeed > 0) {
    if (input.consumeDodge()) {
      // D3 — THE LANE CHANGE: a dodge tap also rotates which rollover lanes are
      // lit, so the last lane you need is something you can line up (exactly
      // what the flipper buttons do on a real table).
      if (rotateLanes()) showPickupNote("⋯ LANE CHANGE");
      p.momSpeed = 0;
    } else if (updatePinball(dt, input)) {
      return;
    }
  }

  // ── Dodge-roll ── it owns the player while active: no attack, no free
  // movement, direction committed. A tap starts one — but a dodge pressed while
  // pressed AGAINST a wall becomes a WALL-KICK rebound off it instead of a roll.
  if (input.consumeDodge()) {
    const wall = currentWallNormal();
    if (!wall || !startWallLaunch("kick", wall, input)) tryStartRoll(input);
  }
  if (updateRoll(dt, input)) return;

  const w = WEAPONS[activeWeapon().id];
  const ranged = w.kind === "ranged";

  // ── Melee attack timeline (windup → active → recovery), driven by p.move ──
  // Ranged weapons keep their own instant-fire path below; only melee uses the
  // phase machine. The active window fires the hit ONCE, scaled by the move.
  let attacking = p.attackT >= 0;
  // A weapon swap mid-swing can STRAND the attack state: a gun's fire animation
  // interrupted by switching to a melee weapon leaves attackT >= 0 with no
  // p.move, so neither timeline below would ever end it — the knight froze in
  // the fire frame, rooted at attack speed (the "gun back to sword breaks the
  // animation" bug). Clear the orphan and hand control back.
  if (attacking && !ranged && !p.move) {
    p.attackT = -1;
    attacking = false;
    p.anim.play("idle", { force: true });
  }
  if (attacking && !ranged && p.move) {
    p.attackT += dt;
    p.comboWindowT = Math.max(0, p.comboWindowT - dt);
    const m = p.move;
    const activeStart = m.windup;
    const activeEnd = m.windup + m.active;
    if (!p.didHit && p.attackT >= activeStart && p.attackT <= activeEnd) {
      p.didHit = true;
      const finisher = m === COMBO_FINISH;
      const landed = resolvePlayerAttack(
        { damageMul: m.damageMul, arcMul: m.arcMul, rangeMul: m.rangeMul, knockbackMul: m.knockbackMul, hitstopMul: m.hitstopMul },
        // Every foe the finisher cuts through leaves a white slice-ghost.
        finisher ? (z) => state.vfx?.ghost(z.sprite.mesh, 0xffffff, 0.2, 0.6) : undefined,
      );
      if (finisher && landed) {
        // ── KATANA FLASH ── the payoff beat: the knight blurs white, the
        // screen pops (pixel-pass uFlash, decays in core's render loop), three
        // parallel cuts hang in the air and the contact point erupts.
        state.flashT = FINISHER_FLASH_T;
        state.vfx?.ghost(p.sprite.mesh, 0xffffff, 0.18, 0.9);
        const [ffx, ffz] = FACING_VEC[p.facing];
        for (const yo of [0.3, 0.7, 1.1]) state.vfx?.slash(p.x + ffx * 0.7, yo, p.z + ffz * 0.7, p.facing, 0xffffff);
        state.vfx?.burst(p.x + ffx, 0.6, p.z + ffz, 0xff6600, 20, 4.5);
        state.shakeT = Math.max(state.shakeT, 0.25);
      }
    }
    // A combo can chain once the active window has passed (early recovery); the
    // window stays open COMBO_WINDOW after that so a follow-up press links.
    if (p.attackT >= activeEnd && p.comboWindowT <= 0 && p.comboStep < 2) {
      p.comboWindowT = COMBO_WINDOW;
    }
    // Move done: end the swing. If no combo continued, the step resets.
    if (p.attackT >= m.windup + m.active + m.recovery) {
      p.attackT = -1;
      p.move = null;
      attacking = false;
      if (p.comboWindowT <= 0) p.comboStep = 0;
    }
  } else if (attacking && ranged) {
    // Ranged: the old finish-on-animation behaviour (fireWeapon happened at
    // trigger; the clip just plays out).
    p.attackT += dt;
    if (p.anim.isFinished()) {
      p.attackT = -1;
      attacking = false;
    }
  }
  // Combo window closing with no follow-up resets the chain to light-1.
  if (!attacking && p.comboStep > 0) {
    p.comboWindowT = Math.max(0, p.comboWindowT - dt);
    if (p.comboWindowT <= 0) p.comboStep = 0;
  }

  // ── Movement (slowed mid-swing, facing locked to a melee swing) ──
  // Input is SCREEN-relative (W = up the screen), converted to world ground
  // directions here — under the isometric yaw those are diagonals. This is
  // how Diablo controls feel: the stick/keys always mean what your eyes see.
  const a = input.axis();
  const moving = a.x !== 0 || a.z !== 0;

  // Sprint (hold Shift): the BASE gear kicks in the instant Shift is held (you
  // feel it immediately), while p.sprintCharge (0→1 over SPRINT_RAMP_TIME) spools
  // the top speed the rest of the way to SPRINT_SPEED_MULT — full sprint is
  // earned by a sustained run. Interruptions (a swing, clipping a corner) HOLD
  // the charge for SPRINT_GRACE before it starts bleeding over SPRINT_DECAY_TIME,
  // so combat doesn't erase the spool. FREE — no stamina in the momentum sandbox,
  // so you can sprint forever and the fun is never rationed.
  const wantSprint = input.sprintHeld() && moving && !attacking;
  if (wantSprint) {
    p.sprintCharge = Math.min(1, p.sprintCharge + dt / SPRINT_RAMP_TIME);
    sprintGraceT = SPRINT_GRACE;
  } else if (sprintGraceT > 0) {
    sprintGraceT = Math.max(0, sprintGraceT - dt); // hold the spool through the stumble
  } else {
    p.sprintCharge = Math.max(0, p.sprintCharge - dt / SPRINT_DECAY_TIME);
  }

  // ── OVERCHARGE ── keep sprinting at a FULL spool and the charge overflows
  // into an overcharge meter over OVERCHARGE_TIME; any overcharge ARMS pinball,
  // a full meter is the BALL. It only bleeds when you've genuinely stopped
  // (not full-spool AND no pinball momentum) — so a brief walk-frame between
  // bounces doesn't dump it. updatePinball also feeds it while bouncing.
  // Ticked here so the sprint HUD can show it.
  if (wantSprint && p.sprintCharge >= 0.999) {
    p.overcharge = Math.min(1, p.overcharge + dt / OVERCHARGE_TIME);
  } else if (p.momSpeed <= 0) {
    p.overcharge = Math.max(0, p.overcharge - dt / OVERCHARGE_DECAY);
  }

  // Target speed for this frame, then ramp the smoothed speed toward it. Walk is
  // still snappy; Shift adds SPRINT_BASE_MULT at once and the spool lerps the
  // rest of the way to SPRINT_SPEED_MULT.
  let targetSpeed = PLAYER_SPEED * (attacking ? ATTACK_MOVE_FACTOR : 1);
  targetSpeed *= skillAgg().moveSpeedMult; // Greased Greaves ranks
  if (state.gear.boots !== undefined) targetSpeed *= BOOTS_SPEED_FACTOR;
  if (p.hasteT > 0) targetSpeed *= HASTE_SPEED_MULT; // haste potion: run faster
  if (p.turboT > 0) targetSpeed *= TURBO_WALK_MULT; // turbo: quicker feet too
  if (p.webbedT > 0) targetSpeed *= WEB_SLOW_MULT; // webbed: wading through silk
  if (p.magBootsT <= 0 && overMagStrip()) targetSpeed *= MAGSTRIP_WALK_MULT; // magnet strip drags
  targetSpeed *= (wantSprint ? SPRINT_BASE_MULT : 1) + (SPRINT_SPEED_MULT - SPRINT_BASE_MULT) * p.sprintCharge;
  if (!moving) targetSpeed = 0;

  // ── WALL-RIDE grind ── a charged sprint hugging a wall is a RIDE: extra
  // speed along the face and torch-sparks grinding off the contact edge.
  // Attack mid-grind for the sweeping WALLRIDE slash; dodge to vault off.
  if (wantSprint && p.sprintCharge >= SPRINT_RIDE_THRESHOLD) {
    const wall = currentWallNormal();
    if (wall) {
      targetSpeed *= WALLRIDE_SLIDE_BOOST;
      grindT -= dt;
      if (grindT <= 0) {
        grindT = GRIND_SPARK_INTERVAL;
        // Sparks fly off the wall contact point, kicked back along the slide.
        state.vfx?.sparks(p.x - wall.nx * (PLAYER_R + 0.08), 0.3, p.z - wall.nz * (PLAYER_R + 0.08), wall.nx, wall.nz, 4);
      }
    }
  }

  const rate = (targetSpeed > curSpeed ? MOVE_ACCEL : MOVE_FRICTION) * dt;
  if (curSpeed < targetSpeed) curSpeed = Math.min(targetSpeed, curSpeed + rate);
  else curSpeed = Math.max(targetSpeed, curSpeed - rate);

  if (moving && curSpeed > 1e-3) {
    const wd = screenDirToWorld(a.x, a.z);
    const stepX = wd.x * curSpeed * dt;
    const stepZ = wd.z * curSpeed * dt;
    const res = moveCircle(g, p.x, p.z, PLAYER_R, stepX, stepZ);
    // OVERCHARGED and slamming into a wall at speed → LAUNCH into pinball: the
    // stored momentum takes over and the knight ricochets. This is the "run
    // fast enough and it's a pinball machine" trigger.
    const blocked = Math.abs(res.x - (p.x + stepX)) > 1e-3 || Math.abs(res.z - (p.z + stepZ)) > 1e-3;
    p.x = res.x;
    p.z = res.z;
    if (p.overcharge > 0 && blocked && wantSprint) {
      // A CRACKED band hit at an overcharged sprint smashes open and the run
      // continues THROUGH it as a momentum ride — "run through the secret
      // wall" works exactly the way it looks like it should.
      const wl2 = Math.hypot(wd.x, wd.z) || 1;
      if (trySmashAhead(g, p.x, p.z, wd.x / wl2, wd.z / wl2, Math.abs(wd.x) > 1e-4, Math.abs(wd.z) > 1e-4)) {
        p.momX = wd.x / wl2;
        p.momZ = wd.z / wl2;
        p.momSpeed = Math.max(curSpeed, PLAYER_SPEED * SPRINT_SPEED_MULT);
        p.ramT = 0;
        p.bounceCombo = 1;
        p.bounceComboT = comboWindow(p.bounceCombo);
        syncActorMesh(p);
        return;
      }
      // Launch back along the incoming direction, reflected off the wall.
      const n = currentWallNormal();
      p.momX = n ? n.nx : -wd.x;
      p.momZ = n ? n.nz : -wd.z;
      const ml = Math.hypot(p.momX, p.momZ) || 1;
      p.momX /= ml;
      p.momZ /= ml;
      p.momSpeed = Math.max(curSpeed, PLAYER_SPEED * SPRINT_SPEED_MULT);
      p.ramT = 0;
      p.bounceCombo = 1; // the launch itself is the first bounce of the chain
      p.bounceComboT = comboWindow(p.bounceCombo);
      state.shakeT = Math.max(state.shakeT, 0.2);
      state.vfx?.sparks(p.x + (n ? n.nx : 0) * PLAYER_R, 0.35, p.z + (n ? n.nz : 0) * PLAYER_R, p.momX, p.momZ, 10);
      sfxHeavy();
      syncActorMesh(p);
      return; // pinball owns the knight from the next frame
    }
    // Kick up floor dust at a walking cadence — faster while sprinting (not
    // while rooted mid-swing).
    stepDustT -= dt;
    if (stepDustT <= 0 && !attacking) {
      stepDustT = STEP_DUST_INTERVAL * (wantSprint ? 0.6 : 1);
      state.vfx?.dust(p.x, 0.05, p.z);
    }
  }

  // Pinball parts fire from a WALK too — step on a spring or graze a bumper
  // and the machine launches you into a momentum ride, no overcharge needed.
  touchPinballParts(false, curSpeed, PINBALL_DEPS);
  if (p.momSpeed > 0) {
    syncActorMesh(p);
    return; // a part just launched us — momentum owns the knight from next frame
  }

  // Facing picks from the SCREEN axis, so pressing D always shows the
  // side-facing art regardless of camera yaw. A melee swing locks the facing;
  // ranged fire doesn't — you can hose the flamethrower while turning.
  if (moving && (!attacking || ranged)) {
    p.facing = facingFromVelocity(a.x, a.z, p.facing);
    p.anim.setFacing(p.facing);
  }
  if (!attacking) {
    // Past the run threshold the gait swaps walk→RUN (leaning sprint clip) and
    // the playback rate ramps with the charge — the animation IS the spool
    // readout. Rate snaps back to 1 for every other clip.
    const running = moving && p.sprintCharge > RUN_CLIP_THRESHOLD;
    p.anim.play(moving ? (running ? "run" : "walk") : "idle");
    p.anim.setRate(running ? 1 + RUN_RATE_RAMP * p.sprintCharge : 1);
  }

  // ── Speed aura ── past AURA_MIN_CHARGE the knight trails afterimages; the
  // trail thickens as the spool fills and flips GOLD at full charge.
  if (moving && p.sprintCharge >= AURA_MIN_CHARGE) {
    const k = (p.sprintCharge - AURA_MIN_CHARGE) / (1 - AURA_MIN_CHARGE); // 0..1 over the aura band
    spawnAura(dt, AURA_INTERVAL * (1.3 - 0.6 * k), p.sprintCharge >= AURA_HOT_CHARGE);
  }

  // ── Trigger ──
  if (ranged) {
    // Ranged is unchanged: fire the instant the trigger pulls, only gated by
    // cooldown (the flamethrower re-fires many times per fire animation).
    if (input.consumeAttack() && p.cooldown <= 0) {
      p.attackT = 0;
      p.move = null;
      p.cooldown = w.cooldown * (p.hasteT > 0 ? HASTE_COOLDOWN_MULT : 1) * aggregateCards(state.weaponSlots[state.activeSlot]?.cards).cooldownMult;
      p.anim.setRate(1); // never inherit the run gait's ramped rate
      p.anim.play("attack", { force: true });
      const cursor = input.aimScreen();
      const aim = cursor ? mouseAimDirection(p.x, p.z, cursor) : null;
      let fx: number;
      let fz: number;
      if (aim) {
        fx = aim.x;
        fz = aim.z;
        p.facing = facingFromAim(fx, fz);
        p.anim.setFacing(p.facing);
      } else {
        [fx, fz] = FACING_VEC[p.facing];
      }
      fireWeapon(w, p.x, p.z, fx, fz);
      wearActiveWeapon(); // ammo is spent on the shot, hit or miss
      rangedSfx(w.id);
    }
  } else {
    updateMelee(dt, input, attacking);
  }

  syncActorMesh(p);
}

/**
 * MELEE trigger + charge. A held attack CHARGES; releasing past CHARGE_TIME
 * launches a HEAVY (long telegraph, big arc, ~2× damage), a
 * quick tap fires the next LIGHT in the combo chain (light-1 → light-2 →
 * finisher). A swing can't start until the previous one leaves its active/early
 * recovery — but a NEW light pressed inside the combo window links straight in.
 */
function updateMelee(dt: number, input: InputHandle, attacking: boolean): void {
  const p = state.player;
  if (!p) return;

  const held = input.attackHeldNow();
  const tap = input.consumeAttackTap(); // discrete press edge

  // A swing can begin when idle/cooled-down, OR mid-swing but inside the combo
  // window (that's what lets a chain link straight in).
  const canStartSwing = p.cooldown <= 0 && (!attacking || p.comboWindowT > 0);

  // Buffer a press briefly so a tap landed a hair before the previous swing
  // ends still registers (action-game courtesy). Consumed the moment we can act.
  if (tap) p.attackBufferT = INPUT_BUFFER;
  else p.attackBufferT = Math.max(0, p.attackBufferT - dt);

  // Charge builds only while the button is HELD and holding it isn't already
  // driving a swing. Reset when not held.
  if (held) {
    if (p.chargeT < 0) p.chargeT = 0;
    p.chargeT += dt;
  }

  // ── HEAVY fires the instant charge crosses the threshold (not on release), so
  // it's immune to release-timing jitter — you feel the heavy "go off" mid-hold.
  // A heavy charged while FACING a wall becomes a POUNCE-SLAM (leap off the wall
  // into a radial AoE) instead — the wall version of the big committed hit.
  if (held && p.chargeT >= CHARGE_TIME && canStartSwing) {
    p.chargeT = -1; // consumed; won't also fire a light on release
    p.attackBufferT = 0;
    const wall = currentWallNormal();
    // Facing INTO the wall = the facing dir points opposite the outward normal.
    const [fx, fz] = FACING_VEC[p.facing];
    const facingWall = wall !== null && fx * wall.nx + fz * wall.nz < -0.3;
    if (facingWall && startWallLaunch("pounce", wall!, input)) {
      return; // launched off the wall
    }
    startMelee(HEAVY, 0, "heavy"); // free — heavies aren't rationed anymore
    return;
  }

  // ── LIGHT fires on the press edge (buffered) when we can act and this wasn't
  // a hold that already became a heavy. A quick tap → light; the chain advances.
  const releasedShort = !held && p.chargeT >= 0 && p.chargeT < CHARGE_TIME;
  const wantLight = (p.attackBufferT > 0 || releasedShort) && canStartSwing;
  if (held) return; // still holding, not yet a heavy — wait
  p.chargeT = -1;
  if (!wantLight) return;

  p.attackBufferT = 0;

  // ── WALL-RIDE ── attacking while sprint-charged past the threshold AND
  // alongside a wall converts the light swing into a wide sweeping ride-slash
  // (the "run fast enough → wall ride" ask). Gated ONLY by the sprint spool now
  // (free — no stamina). Falls through to the normal combo swing if not charged
  // or no wall.
  if (p.sprintCharge >= SPRINT_RIDE_THRESHOLD && currentWallNormal()) {
    startMelee(WALLRIDE, 0, "heavy"); // "heavy" kind → the meatier swing sfx/vfx
    return;
  }

  const move = p.comboStep === 0 ? LIGHT_1 : p.comboStep === 1 ? LIGHT_2 : COMBO_FINISH;
  const nextStep = Math.min(2, p.comboStep + 1);
  startMelee(move, nextStep, "light");
}

/** Begin a melee swing: set the move timeline, combo step, play the clip + fx/sfx. */
function startMelee(move: MoveTiming, comboStep: number, kind: "light" | "heavy"): void {
  const p = state.player;
  if (!p) return;
  p.move = move;
  p.comboStep = comboStep;
  p.attackT = 0;
  p.didHit = false;
  p.comboWindowT = 0;
  p.cooldown = 0; // the move's own recovery gates the next swing now
  p.anim.setRate(1); // never inherit the run gait's ramped rate
  p.anim.play("attack", { force: true });
  if (kind === "heavy") sfxHeavy();
  else sfxSwing();
  // Slash crescent swept in the facing direction; a heavy/finisher throws a
  // bigger, weapon-tinted arc.
  const w = WEAPONS[activeWeapon().id];
  const [fx, fz] = FACING_VEC[p.facing];
  const scale = move === HEAVY ? 1.5 : move === COMBO_FINISH ? 1.3 : 1;
  state.vfx?.slash(p.x + fx * 0.5 * scale, 0.6, p.z + fz * 0.5 * scale, p.facing, w.slashColor ?? 0xdfe7f2);
}

