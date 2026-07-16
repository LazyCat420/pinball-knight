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
import {
  PLAYER_SPEED,
  PLAYER_R,
  ZOMBIE_R,
  BOOTS_SPEED_FACTOR,
  STAMINA_MAX,
  STAMINA_REGEN,
  STAMINA_REGEN_DELAY,
  SPRINT_DRAIN,
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
  WALLRIDE_SLIDE_BOOST,
  GRIND_SPARK_INTERVAL,
  OVERCHARGE_TIME,
  OVERCHARGE_DECAY,
  PINBALL_RESTITUTION,
  PINBALL_FRICTION,
  PINBALL_STEER,
  PINBALL_EXIT_MULT,
  BALL_SPEED_MULT,
  BALL_RAM_COOLDOWN,
  BALL_RAM_KNOCKBACK,
  MOVE_ACCEL,
  MOVE_FRICTION,
  ROLL_DURATION,
  ROLL_IFRAMES,
  ROLL_DISTANCE,
  ROLL_RECOVERY,
  DODGE_COST,
  LIGHT_1,
  LIGHT_2,
  COMBO_FINISH,
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
import { facingFromVelocity, type Facing } from "../render/animator";
import { screenDirToWorld, worldDirToScreen, mouseAimDirection } from "../camera";
import type { InputHandle } from "../input";
import { WEAPONS } from "../items";
import { resolvePlayerAttack, wearActiveWeapon, syncActorMesh, updateFlash, FACING_VEC, damageZombie, playerDamage } from "./combat";
import { fireWeapon } from "./projectiles";
import { sfxSwing, sfxGun, sfxBow, sfxFlame, sfxRoll, sfxHeavy } from "../audio";

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

/** Reset per-run movement smoothing so a fresh descent doesn't inherit momentum. */
export function resetPlayerMotion(): void {
  curSpeed = 0;
  stepDustT = 0;
  sprintGraceT = 0;
  auraT = 0;
  grindT = 0;
  if (state.player) state.player.sprintCharge = 0;
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

/** Dev telemetry: the smoothed movement speed (units/sec) for the QA hook. */
export function debugCurSpeed(): number {
  return curSpeed;
}

/** Dev telemetry: the current wall normal (or null) for headless wall-move tests. */
export function debugWallNormal(): { nx: number; nz: number } | null {
  return currentWallNormal();
}

/**
 * Drain/refill the stamina bar. Any spend (sprint tick, dodge, heavy) pushes the
 * regen delay out; once it elapses, stamina pours back. Returns nothing —
 * mutates the player. Spends are applied by the caller via spendStamina().
 */
function tickStamina(dt: number): void {
  const p = state.player;
  if (!p) return;
  p.staminaRegenDelay = Math.max(0, p.staminaRegenDelay - dt);
  if (p.staminaRegenDelay <= 0 && p.stamina < STAMINA_MAX) {
    p.stamina = Math.min(STAMINA_MAX, p.stamina + STAMINA_REGEN * dt);
  }
}

/** Spend stamina and pause regen. Returns false (no spend) if there isn't enough. */
export function spendStamina(amount: number): boolean {
  const p = state.player;
  if (!p) return false;
  if (p.stamina < amount) return false;
  p.stamina -= amount;
  p.staminaRegenDelay = STAMINA_REGEN_DELAY;
  return true;
}

/** Peak roll speed (units/sec). v(τ)=v0·(1−τ) integrates to ROLL_DISTANCE over ROLL_DURATION. */
const ROLL_V0 = (2 * ROLL_DISTANCE) / ROLL_DURATION;

/**
 * Begin a dodge-roll if allowed. Commits the current input direction (or the
 * facing if standing still) — it's LOCKED for the whole roll, which is what
 * makes timing + aim matter. Costs stamina. Returns true if the roll started.
 */
function tryStartRoll(input: InputHandle): boolean {
  const p = state.player;
  const g = state.grid;
  if (!p || !g || p.rollT >= 0) return false; // already rolling
  if (!spendStamina(DODGE_COST)) return false; // not enough stamina

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
    // already paid its stamina); only during the roll body, and only when the
    // roll direction genuinely points at the wall we just hit.
    const wall = wallContact(g, p.x, p.z, PLAYER_R, WALL_CONTACT_PROBE);
    if (wall && p.rollDirX * wall.nx + p.rollDirZ * wall.nz < -0.5) {
      if (startWallLaunch("kick", wall, input, true)) return true;
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
 * (the wall normal, biased by input for the kick), spends stamina, and — for the
 * kick — queues a lunging light strike that lands as the hop peaks. Returns true
 * if it started. `free` skips the stamina price — used when a dodge-roll that
 * already paid converts into a kick mid-tumble.
 */
function startWallLaunch(kind: "kick" | "pounce", normal: { nx: number; nz: number }, input: InputHandle, free = false): boolean {
  const p = state.player;
  if (!p) return false;
  const move = kind === "kick" ? WALLKICK : POUNCE;
  if (!free && !spendStamina(move.staminaCost)) return false;

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
  }
  if (state.zombies.some((z) => z.mode !== "dead")) wearActiveWeapon();
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

  const isBall = p.overcharge >= 1;
  const speedMul = isBall ? BALL_SPEED_MULT : 1;

  // Steer: held input gently BENDS the momentum direction (a nudge, not full
  // control — it's a physics roll, not a walk). Keeps it playable, not chaos.
  const a = input.axis();
  if (a.x !== 0 || a.z !== 0) {
    const wd = screenDirToWorld(a.x, a.z);
    const wl = Math.hypot(wd.x, wd.z) || 1;
    p.momX += (wd.x / wl) * PINBALL_STEER * dt;
    p.momZ += (wd.z / wl) * PINBALL_STEER * dt;
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
  const res = moveCircle(g, p.x, p.z, PLAYER_R, p.momX * step, p.momZ * step);
  const blockedX = Math.abs(res.x - wantX) > 1e-3;
  const blockedZ = Math.abs(res.z - wantZ) > 1e-3;
  p.x = res.x;
  p.z = res.z;

  if (blockedX || blockedZ) {
    // Axis-aligned reflection (grid walls are axis-aligned): flip the blocked
    // component. This is a clean pinball ricochet off a flat wall face.
    if (blockedX) p.momX = -p.momX;
    if (blockedZ) p.momZ = -p.momZ;
    p.momSpeed *= PINBALL_RESTITUTION;
    // Bounce juice: sparks off the wall, a kick, a clack.
    const n = currentWallNormal();
    const sx = n ? n.nx : -p.momX;
    const sz = n ? n.nz : -p.momZ;
    state.vfx?.sparks(p.x + sx * PLAYER_R, 0.35, p.z + sz * PLAYER_R, sx, sz, 8);
    state.shakeT = Math.max(state.shakeT, 0.14);
    state.hitstopT = Math.max(state.hitstopT, 0.03);
    sfxRoll();
  }

  // Friction bleeds momentum every frame.
  p.momSpeed = Math.max(0, p.momSpeed - PINBALL_FRICTION * dt);

  // Ball form rams the horde: anything the ball touches gets smashed aside.
  p.ramT = Math.max(0, p.ramT - dt);
  if (isBall && p.ramT <= 0) {
    const w = WEAPONS[activeWeapon().id];
    const dmg = playerDamage(Math.max(2, w.damage * 1.5));
    let hit = false;
    for (const z of state.zombies) {
      if (z.mode === "dead") continue;
      const dx = z.x - p.x;
      const dz = z.z - p.z;
      if (dx * dx + dz * dz > (PLAYER_R + ZOMBIE_R + 0.15) * (PLAYER_R + ZOMBIE_R + 0.15)) continue;
      damageZombie(z, dmg, p.momX, p.momZ, BALL_RAM_KNOCKBACK);
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
  spawnAura(dt, isBall ? 0.05 : 0.07, true, 0.3, 0.45);
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

  // Exit when the momentum has bled off — or immediately if overcharge is gone.
  if (p.momSpeed < PLAYER_SPEED * PINBALL_EXIT_MULT || p.overcharge <= 0) {
    p.momSpeed = 0;
    p.overcharge = Math.min(p.overcharge, 0.999); // drop out of ball form
    p.anim.setRate(1);
    p.anim.play("idle", { force: true });
  }

  syncActorMesh(p);
  return true;
}

/** Kick the knight into pinball mode with the current sprint velocity. */
function enterPinball(): void {
  const p = state.player;
  if (!p || p.momSpeed > 0) return;
  const dir = FACING_VEC[p.facing];
  // Launch along the current facing (which tracks movement) at the sprint speed.
  p.momX = dir[0];
  p.momZ = dir[1];
  const len = Math.hypot(p.momX, p.momZ) || 1;
  p.momX /= len;
  p.momZ /= len;
  p.momSpeed = Math.max(curSpeed, PLAYER_SPEED * SPRINT_SPEED_MULT);
  p.ramT = 0;
  state.shakeT = Math.max(state.shakeT, 0.2);
  sfxHeavy();
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

export function updatePlayer(dt: number, input: InputHandle): void {
  const p = state.player;
  const g = state.grid;
  if (!p || !g || p.hp <= 0) return;

  p.cooldown = Math.max(0, p.cooldown - dt);
  p.iframes = Math.max(0, p.iframes - dt);
  tickStamina(dt);
  updateFlash(p, dt);

  // ── Wall launch (wall-kick / pounce) ── owns the player while airborne.
  if (updateWallLaunch(dt)) return;

  // ── Pinball ── while momentum is live the knight bounces off walls and owns
  // the player. A dodge tap BAILS OUT of it (kill the momentum, then fall
  // through so the same tap can start a roll off the exit).
  if (p.momSpeed > 0) {
    if (input.consumeDodge()) {
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
      resolvePlayerAttack({ damageMul: m.damageMul, arcMul: m.arcMul, rangeMul: m.rangeMul, knockbackMul: m.knockbackMul, hitstopMul: m.hitstopMul });
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
  // so combat doesn't erase the spool. Gated by stamina — an empty bar can't
  // sprint. Stamina drains only while the charge is actually building/held.
  const wantSprint = input.sprintHeld() && moving && !attacking && p.stamina > 0;
  if (wantSprint) {
    p.sprintCharge = Math.min(1, p.sprintCharge + dt / SPRINT_RAMP_TIME);
    sprintGraceT = SPRINT_GRACE;
    p.stamina = Math.max(0, p.stamina - SPRINT_DRAIN * dt);
    // Suppress regen for the full delay while sprinting — otherwise tickStamina
    // (which ran earlier this frame) refills faster than the drain and the bar
    // never falls. Refreshing the delay each sprint frame keeps regen paused
    // until STAMINA_REGEN_DELAY after you STOP sprinting.
    p.staminaRegenDelay = STAMINA_REGEN_DELAY;
  } else if (sprintGraceT > 0) {
    sprintGraceT = Math.max(0, sprintGraceT - dt); // hold the spool through the stumble
  } else {
    p.sprintCharge = Math.max(0, p.sprintCharge - dt / SPRINT_DECAY_TIME);
  }

  // Target speed for this frame, then ramp the smoothed speed toward it. Walk is
  // still snappy; Shift adds SPRINT_BASE_MULT at once and the spool lerps the
  // rest of the way to SPRINT_SPEED_MULT.
  let targetSpeed = PLAYER_SPEED * (attacking ? ATTACK_MOVE_FACTOR : 1);
  if (state.gear.boots !== undefined) targetSpeed *= BOOTS_SPEED_FACTOR;
  if (p.hasteT > 0) targetSpeed *= HASTE_SPEED_MULT; // haste potion: run faster
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
    const res = moveCircle(g, p.x, p.z, PLAYER_R, wd.x * curSpeed * dt, wd.z * curSpeed * dt);
    p.x = res.x;
    p.z = res.z;
    // Kick up floor dust at a walking cadence — faster while sprinting (not
    // while rooted mid-swing).
    stepDustT -= dt;
    if (stepDustT <= 0 && !attacking) {
      stepDustT = STEP_DUST_INTERVAL * (wantSprint ? 0.6 : 1);
      state.vfx?.dust(p.x, 0.05, p.z);
    }
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
      p.cooldown = w.cooldown * (p.hasteT > 0 ? HASTE_COOLDOWN_MULT : 1);
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
 * launches a HEAVY (long telegraph, big arc, ~2× damage, costs stamina), a
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
    if (spendStamina(HEAVY.staminaCost)) {
      startMelee(HEAVY, 0, "heavy");
    } else {
      startMelee(LIGHT_1, 1, "light"); // empty bar → the press still swings light
    }
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
  // (the "run fast enough → wall ride" ask). Gated by the 3s sprint spool so it
  // only fires off a committed run, and by stamina. Falls through to the normal
  // combo swing if not charged / no wall / no stamina.
  if (p.sprintCharge >= SPRINT_RIDE_THRESHOLD && currentWallNormal() && spendStamina(WALLRIDE.staminaCost)) {
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
