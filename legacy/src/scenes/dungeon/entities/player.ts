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
  PINBALL_WALL_RESTITUTION,
  PINBALL_CORNER_RESTITUTION,
  PINBALL_CORNER_ADD,
  PINBALL_MAX_SPEED,
  PINBALL_FRICTION,
  PINBALL_STEER,
  PINBALL_EXIT_MULT,
  PINBALL_COMBO_WINDOW,
  BALL_SPEED_MULT,
  BALL_RAM_COOLDOWN,
  BALL_RAM_KNOCKBACK,
  BUMPER_RADIUS,
  BUMPER_KICK_MULT,
  BUMPER_KICK_ADD,
  BUMPER_MIN_EXIT,
  BUMPER_COOLDOWN,
  BUMPER_SCATTER,
  SPRING_SPEED,
  SPRING_COOLDOWN,
  RAMP_SPEED,
  RAMP_COOLDOWN,
  RAMP_STEER_LOCK,
  DEFLECTOR_BOOST,
  SECRET_BREAK_SPEED,
  OIL_RADIUS,
  OIL_LAUNCH_SPEED,
  OIL_LAUNCH_MULT,
  OIL_SLICK_TIME,
  OIL_STEER_FACTOR,
  SPINPAD_SPEED,
  SPINPAD_COOLDOWN,
  SLING_SPEED_MULT,
  SLING_ADD,
  SLING_MIN_EXIT,
  SLING_COOLDOWN,
  TARGET_HIT_SPEED,
  TARGET_RADIUS,
  TARGET_GOLD,
  TARGET_CLEAR_GOLD,
  TRAPDOOR_RIDE_SPEED,
  TRAPDOOR_RIDE_MIN,
  TRAPDOOR_RIDE_MAX,
  TRAPDOOR_EXIT_SPEED,
  TRAPDOOR_HEIGHT,
  TRAPDOOR_COOLDOWN,
  FRENZY_PART_HITS,
  FRENZY_GOLD,
  WEB_SLOW_MULT,
  IRONCORE_RAM_MULT,
  TURBO_STEER_MULT,
  TURBO_WALK_MULT,
  SPRINGLEGS_RESTITUTION,
  MOVE_ACCEL,
  MOVE_FRICTION,
  ROLL_DURATION,
  ROLL_IFRAMES,
  ROLL_DISTANCE,
  ROLL_RECOVERY,
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
import { at, T_CRACKED, isWalkable, tileCenter, worldToTile, type Grid } from "../maze/generator";
import { addGold } from "../../../utils/gold-wallet";
import { showPickupNote, showToast } from "../ui";
import { smashSecretAt } from "../secrets";
import { facingFromVelocity, type Facing } from "../render/animator";
import { screenDirToWorld, worldDirToScreen, mouseAimDirection } from "../camera";
import type { InputHandle } from "../input";
import { WEAPONS } from "../items";
import { resolvePlayerAttack, wearActiveWeapon, syncActorMesh, updateFlash, FACING_VEC, damageZombie, playerDamage } from "./combat";
import { fireWeapon } from "./projectiles";
import { sfxSwing, sfxGun, sfxBow, sfxFlame, sfxRoll, sfxHeavy, sfxBumper, sfxSpring, sfxSpin, sfxTarget, sfxTrapdoor } from "../audio";

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
 * Interact with the level's PINBALL PARTS. Called from updatePinball (momentum
 * live) AND from the normal movement path (walking) — every part can START a
 * momentum ride, which is what makes the maze read as a machine: step on a
 * spring or graze a bumper and you're flying, no overcharge required.
 *
 *   bumper    → radial kick away from its centre, speed multiplied + added,
 *               combo tick. Even a walking touch launches at BUMPER_MIN_EXIT.
 *   spring    → forced launch along the spring's direction at SPRING_SPEED.
 *   ramp      → dash pad: forces your heading to its direction and floors your
 *               speed at RAMP_SPEED (Sonic dash-panel rule: set, don't add).
 *   deflector → banked curve, MOMENTUM ONLY: entering the corner redirects you
 *               around it with all your speed (×DEFLECTOR_BOOST) — the reward
 *               for taking the racing line instead of slamming the wall.
 *
 * Part cooldowns/hit animations are ticked by the parts renderer (one owner);
 * this only consumes ready parts and stamps cooldownT/hitT.
 */
/**
 * Bookkeeping every PART trigger shares: tick the bounce combo, shake a web
 * off (parts are the webspinner's cleanse), count part-hits toward the
 * MULTIBALL FRENZY bonus and pay it once per combo.
 */
function onPartTrigger(): void {
  const p = state.player;
  if (!p) return;
  p.bounceCombo += 1;
  p.bounceComboT = PINBALL_COMBO_WINDOW;
  if (p.webbedT > 0) {
    p.webbedT = 0;
    showPickupNote("🕸️ web SHAKEN OFF");
  }
  state.partComboHits += 1;
  if (!state.frenzyPaid && state.partComboHits >= FRENZY_PART_HITS) {
    state.frenzyPaid = true;
    state.goldRun += FRENZY_GOLD;
    addGold(FRENZY_GOLD, "dungeon-game");
    showToast("🪩 MULTIBALL FRENZY", `${state.partComboHits} parts in one chain · +${FRENZY_GOLD}g`);
    state.shakeT = Math.max(state.shakeT, 0.25);
  }
}

function touchPinballParts(inMomentum: boolean): void {
  const p = state.player;
  if (!p || state.pinballParts.length === 0) return;

  for (const part of state.pinballParts) {
    if (part.cooldownT > 0) continue;
    const dx = p.x - part.x;
    const dz = p.z - part.z;
    const d2 = dx * dx + dz * dz;

    if (part.kind === "bumper") {
      const r = BUMPER_RADIUS + PLAYER_R * 0.5;
      if (d2 > r * r) continue;
      const d = Math.sqrt(d2) || 1;
      // Radial exit with the authentic ±6° scatter (active parts only — plain
      // walls stay mirror-perfect, per the research).
      const scatter = (Math.random() * 2 - 1) * BUMPER_SCATTER;
      const cs = Math.cos(scatter);
      const sn = Math.sin(scatter);
      const nx = dx / d;
      const nz = dz / d;
      p.momX = nx * cs - nz * sn;
      p.momZ = nx * sn + nz * cs;
      p.momSpeed = Math.min(
        PINBALL_MAX_SPEED,
        Math.max(p.momSpeed * BUMPER_KICK_MULT + BUMPER_KICK_ADD, BUMPER_MIN_EXIT),
      );
      onPartTrigger();
      part.cooldownT = BUMPER_COOLDOWN;
      part.hitT = 0;
      state.vfx?.sparks(part.x, 0.5, part.z, dx, dz, 12);
      state.shakeT = Math.max(state.shakeT, 0.16);
      state.hitstopT = Math.max(state.hitstopT, 0.03);
      sfxBumper();
    } else if (part.kind === "spring") {
      if (d2 > 0.42 * 0.42) continue;
      p.momX = part.dirX;
      p.momZ = part.dirZ;
      p.momSpeed = Math.min(PINBALL_MAX_SPEED, Math.max(p.momSpeed, SPRING_SPEED));
      onPartTrigger();
      part.cooldownT = SPRING_COOLDOWN;
      part.hitT = 0;
      state.vfx?.dust(part.x, 0.1, part.z);
      state.vfx?.sparks(part.x, 0.3, part.z, part.dirX, part.dirZ, 8);
      state.shakeT = Math.max(state.shakeT, 0.14);
      sfxSpring();
    } else if (part.kind === "ramp") {
      if (d2 > 0.42 * 0.42) continue;
      p.momX = part.dirX;
      p.momZ = part.dirZ;
      // Sonic's booster rule: a FLOOR, never a brake — plus a short steer lock
      // so the panel actually carries you down its lane before you can bend it.
      p.momSpeed = Math.min(PINBALL_MAX_SPEED, Math.max(p.momSpeed, RAMP_SPEED));
      steerLockT = RAMP_STEER_LOCK;
      part.cooldownT = RAMP_COOLDOWN;
      part.hitT = 0;
      state.vfx?.dust(p.x, 0.06, p.z);
      sfxRoll();
    } else if (part.kind === "oil") {
      // The slick: a WALKING touch converts your stride into a frictionless
      // slide along your heading; riding over it re-greases the momentum.
      if (d2 > OIL_RADIUS * OIL_RADIUS) continue;
      if (inMomentum) {
        p.oilT = OIL_SLICK_TIME; // keep the ride greased (no friction, dead steering)
        continue; // no cooldown stamp — the slick is a zone, not a trigger
      }
      if (curSpeed < 0.5) continue; // standing on oil is just standing
      const a = state.input?.axis() ?? { x: 0, z: 0 };
      if (a.x === 0 && a.z === 0) continue;
      const wd = screenDirToWorld(a.x, a.z);
      const wl = Math.hypot(wd.x, wd.z) || 1;
      p.momX = wd.x / wl;
      p.momZ = wd.z / wl;
      p.momSpeed = Math.min(PINBALL_MAX_SPEED, Math.max(curSpeed * OIL_LAUNCH_MULT, OIL_LAUNCH_SPEED));
      p.oilT = OIL_SLICK_TIME;
      part.cooldownT = 0.4;
      part.hitT = 0;
      state.vfx?.dust(p.x, 0.04, p.z);
      sfxRoll();
    } else if (part.kind === "spinpad") {
      // The slot machine: a random-direction fling at speed.
      if (d2 > 0.45 * 0.45) continue;
      const ang = Math.random() * Math.PI * 2;
      p.momX = Math.cos(ang);
      p.momZ = Math.sin(ang);
      p.momSpeed = Math.min(PINBALL_MAX_SPEED, Math.max(p.momSpeed, SPINPAD_SPEED));
      onPartTrigger();
      part.cooldownT = SPINPAD_COOLDOWN;
      part.hitT = 0;
      state.vfx?.sparks(part.x, 0.3, part.z, p.momX, p.momZ, 10);
      state.shakeT = Math.max(state.shakeT, 0.14);
      sfxSpin();
    } else if (part.kind === "slingshot") {
      if (d2 > 0.5 * 0.5) continue;
      if (inMomentum) {
        // Passing the gate with momentum PINGS you out along the lane —
        // whichever way you were already mostly going.
        const along = p.momX * part.dirX + p.momZ * part.dirZ >= 0 ? 1 : -1;
        p.momX = part.dirX * along;
        p.momZ = part.dirZ * along;
        p.momSpeed = Math.min(PINBALL_MAX_SPEED, Math.max(p.momSpeed * SLING_SPEED_MULT + SLING_ADD, SLING_MIN_EXIT));
      } else {
        p.momX = part.dirX;
        p.momZ = part.dirZ;
        p.momSpeed = SLING_MIN_EXIT;
      }
      onPartTrigger();
      part.cooldownT = SLING_COOLDOWN;
      part.hitT = 0;
      state.vfx?.sparks(part.x, 0.35, part.z, p.momX, p.momZ, 9);
      sfxSpring();
    } else if (part.kind === "target") {
      // Bullseyes break to MOMENTUM only — the floor's objective layer.
      if (part.done || !inMomentum || p.momSpeed < TARGET_HIT_SPEED) continue;
      if (d2 > TARGET_RADIUS * TARGET_RADIUS) continue;
      part.done = true;
      part.hitT = 0;
      state.targetsHit += 1;
      onPartTrigger();
      state.goldRun += TARGET_GOLD;
      addGold(TARGET_GOLD, "dungeon-game");
      state.vfx?.sparks(part.x, 0.6, part.z, dx, dz, 14);
      state.shakeT = Math.max(state.shakeT, 0.14);
      sfxTarget();
      if (state.targetsHit >= state.targetsTotal && state.targetsTotal > 0) {
        state.goldRun += TARGET_CLEAR_GOLD;
        addGold(TARGET_CLEAR_GOLD, "dungeon-game");
        showToast("🎯 ALL TARGETS DOWN", `the machine pays out · +${TARGET_CLEAR_GOLD}g`);
      } else {
        showPickupNote(`🎯 TARGET ${state.targetsHit}/${state.targetsTotal} +${TARGET_GOLD}g`);
      }
      state.hudDirty = true;
    } else if (part.kind === "trapdoor") {
      // The hatch drops you onto the rollercoaster — see startRide.
      if (d2 > 0.42 * 0.42) continue;
      if (p.rideT >= 0) continue;
      part.cooldownT = TRAPDOOR_COOLDOWN;
      part.hitT = 0;
      startRide();
    } else {
      // deflector — banked corner, only meaningful while carrying momentum
      if (!inMomentum || d2 > 0.5 * 0.5) continue;
      // Which leg did we come IN along? Exit along the other, speed intact.
      const inFrom1 = p.momX * -part.dirX + p.momZ * -part.dirZ; // heading INTO leg 1
      const inFrom2 = p.momX * -part.dir2X + p.momZ * -part.dir2Z;
      if (inFrom1 < 0.3 && inFrom2 < 0.3) continue; // grazing past, not cornering
      if (inFrom1 >= inFrom2) {
        p.momX = part.dir2X;
        p.momZ = part.dir2Z;
      } else {
        p.momX = part.dirX;
        p.momZ = part.dirZ;
      }
      p.momSpeed = Math.min(PINBALL_MAX_SPEED, p.momSpeed * DEFLECTOR_BOOST);
      onPartTrigger();
      part.cooldownT = 0.3;
      part.hitT = 0;
      state.vfx?.sparks(part.x, 0.3, part.z, p.momX, p.momZ, 6);
      sfxRoll();
    }
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

/** The hatch opens: build the spline and hand the player to the rail. */
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
  p.anim.play("ball", { force: true });
  state.shakeT = Math.max(state.shakeT, 0.2);
  showToast("🎢 TRAPDOOR!", "hold on");
  sfxTrapdoor();
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
  const h = Math.sin(Math.PI * u) * TRAPDOOR_HEIGHT;
  p.sprite.mesh.position.y = h;

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
    p.momX = dx / dl;
    p.momZ = dz / dl;
    p.momSpeed = TRAPDOOR_EXIT_SPEED;
    p.ramT = 0;
    onPartTrigger();
    for (let k = 0; k < 3; k++) state.vfx?.dust(p.x + (Math.random() - 0.5) * 0.5, 0.04, p.z + (Math.random() - 0.5) * 0.5);
    state.shakeT = Math.max(state.shakeT, 0.25);
    sfxHeavy();
  }
  return true;
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

  // Overcharge keeps building WHILE bouncing — you're obviously moving fast, so
  // the ride itself charges toward ball form. Without this the first wall slam
  // launches pinball and starves the ground-sprint that was building overcharge,
  // making ball form effectively unreachable (caught by driving it).
  p.overcharge = Math.min(1, p.overcharge + dt / OVERCHARGE_TIME);

  // Steer: held input gently BENDS the momentum direction (a nudge, not full
  // control — it's a physics roll, not a walk). Keeps it playable, not chaos.
  // A dash panel locks steering briefly so its lane actually carries you.
  steerLockT = Math.max(0, steerLockT - dt);
  const a = input.axis();
  // Oil kills the steering (you're on a slick); turbo sharpens it.
  const steerMul = p.oilT > 0 ? OIL_STEER_FACTOR : p.turboT > 0 ? TURBO_STEER_MULT : 1;
  if (steerLockT <= 0 && (a.x !== 0 || a.z !== 0)) {
    const wd = screenDirToWorld(a.x, a.z);
    const wl = Math.hypot(wd.x, wd.z) || 1;
    p.momX += (wd.x / wl) * PINBALL_STEER * steerMul * dt;
    p.momZ += (wd.z / wl) * PINBALL_STEER * steerMul * dt;
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
    // SECRET WALL: enough momentum landing on a CRACKED band shatters it — the
    // knight barrels straight through the new gap (no reflection), spending a
    // slice of speed on the masonry. Still a combo tick: smashing IS style.
    if (p.momSpeed >= SECRET_BREAK_SPEED && trySmashAhead(g, p.x, p.z, p.momX, p.momZ, blockedX, blockedZ)) {
      p.momSpeed *= 0.85;
      p.bounceCombo += 1;
      p.bounceComboT = PINBALL_COMBO_WINDOW;
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
    const flatRest = p.springT > 0 ? SPRINGLEGS_RESTITUTION : PINBALL_WALL_RESTITUTION;
    p.momSpeed = corner
      ? Math.min(PINBALL_MAX_SPEED, p.momSpeed * PINBALL_CORNER_RESTITUTION + PINBALL_CORNER_ADD)
      : Math.min(PINBALL_MAX_SPEED, p.momSpeed * flatRest);
    p.bounceCombo += 1;
    p.bounceComboT = PINBALL_COMBO_WINDOW;
    // Bounce juice scales with the combo — a corner hit throws a bigger burst.
    const n = currentWallNormal();
    const sx = n ? n.nx : -p.momX;
    const sz = n ? n.nz : -p.momZ;
    state.vfx?.sparks(p.x + sx * PLAYER_R, 0.35, p.z + sz * PLAYER_R, sx, sz, (corner ? 14 : 6) + Math.min(10, p.bounceCombo * 2));
    state.shakeT = Math.max(state.shakeT, (corner ? 0.18 : 0.1) + Math.min(0.12, p.bounceCombo * 0.02));
    state.hitstopT = Math.max(state.hitstopT, corner ? 0.05 : 0.02);
    sfxRoll();
  }

  // Pinball PARTS: bumpers kick, springs launch, ramps floor your speed,
  // deflectors bank you around corners. The real accelerators of the machine.
  touchPinballParts(true);

  // Momentum bleeds ONLY when NOT bouncing (Sonic keeps its speed on a good
  // line) — very gently. Oil grease and Turbo Charge kill the bleed outright.
  // The combo lapses if you go too long without a wall.
  const friction = p.oilT > 0 || p.turboT > 0 ? 0 : PINBALL_FRICTION;
  p.momSpeed = Math.max(0, p.momSpeed - friction * dt);
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

  // Exit only when the momentum has genuinely bled off. (Overcharge no longer
  // gates the ride — bumpers/springs/ramps can launch momentum from a cold
  // start, so the machine works without spooling first. Overcharge is purely
  // the BALL-form gate now.)
  if (p.momSpeed < PLAYER_SPEED * PINBALL_EXIT_MULT) {
    p.momSpeed = 0;
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

export function updatePlayer(dt: number, input: InputHandle): void {
  const p = state.player;
  const g = state.grid;
  if (!p || !g || p.hp <= 0) return;

  p.cooldown = Math.max(0, p.cooldown - dt);
  p.iframes = Math.max(0, p.iframes - dt);
  p.oilT = Math.max(0, p.oilT - dt);
  p.webbedT = Math.max(0, p.webbedT - dt);
  updateFlash(p, dt);

  // ── Trapdoor coaster ── the rail owns the player completely while riding.
  if (updateRide(dt)) return;

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
  if (state.gear.boots !== undefined) targetSpeed *= BOOTS_SPEED_FACTOR;
  if (p.hasteT > 0) targetSpeed *= HASTE_SPEED_MULT; // haste potion: run faster
  if (p.turboT > 0) targetSpeed *= TURBO_WALK_MULT; // turbo: quicker feet too
  if (p.webbedT > 0) targetSpeed *= WEB_SLOW_MULT; // webbed: wading through silk
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
        p.bounceComboT = PINBALL_COMBO_WINDOW;
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
      p.bounceComboT = PINBALL_COMBO_WINDOW;
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
  touchPinballParts(false);
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

/**
 * MULTI-BALL (Wave F): while the buff runs, two ghost knights flank the hero,
 * mirroring the run, and RAM any zombie they overlap. Their meshes are owned
 * by core (created on pickup, torn down on expiry); this owns the sim: place
 * them beside the travel direction and deal the contact damage.
 */
export function updateMultiball(dt: number): void {
  const p = state.player;
  const meshes = state.multiMeshes;
  if (!p || !meshes || meshes.length === 0) return;

  // Flank perpendicular to travel (momentum if riding, facing otherwise).
  let dx = p.momSpeed > 0 ? p.momX : FACING_VEC[p.facing][0];
  let dz = p.momSpeed > 0 ? p.momZ : FACING_VEC[p.facing][1];
  const dl = Math.hypot(dx, dz) || 1;
  dx /= dl;
  dz /= dl;
  const offsets: Array<[number, number]> = [
    [-dz * 0.9, dx * 0.9],
    [dz * 0.9, -dx * 0.9],
  ];
  state.multiRamT = Math.max(0, state.multiRamT - dt);
  const w = WEAPONS[activeWeapon().id];
  meshes.forEach((mesh, k) => {
    const gx = p.x + offsets[k][0];
    const gz = p.z + offsets[k][1];
    // Same iso pixel-snap as every actor, then hover a hair for the spectre read.
    const fake = { sprite: { mesh: { position: mesh.position } }, x: gx, z: gz };
    syncActorMesh(fake as Parameters<typeof syncActorMesh>[0]);
    mesh.position.y = 0.06 + Math.sin(state.elapsed * 5 + k * Math.PI) * 0.04;
    if (state.multiRamT <= 0) {
      for (const z of state.zombies) {
        if (z.mode === "dead") continue;
        const zdx = z.x - gx;
        const zdz = z.z - gz;
        if (zdx * zdx + zdz * zdz > 0.55 * 0.55) continue;
        damageZombie(z, playerDamage(Math.max(1, w.damage)), zdx, zdz, 0.6);
        state.multiRamT = 0.3;
        break;
      }
    }
  });
}
