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
  BOOTS_SPEED_FACTOR,
  STAMINA_MAX,
  STAMINA_REGEN,
  STAMINA_REGEN_DELAY,
  SPRINT_DRAIN,
  SPRINT_SPEED_MULT,
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
  type MoveTiming,
} from "../constants";
import { HASTE_SPEED_MULT, HASTE_COOLDOWN_MULT } from "../items";
import { moveCircle } from "../collision";
import { facingFromVelocity, type Facing } from "../render/animator";
import { screenDirToWorld, worldDirToScreen, mouseAimDirection } from "../camera";
import type { InputHandle } from "../input";
import { WEAPONS } from "../items";
import { resolvePlayerAttack, wearActiveWeapon, syncActorMesh, updateFlash, FACING_VEC } from "./combat";
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

/** Reset per-run movement smoothing so a fresh descent doesn't inherit momentum. */
export function resetPlayerMotion(): void {
  curSpeed = 0;
  stepDustT = 0;
}

/** Dev telemetry: the smoothed movement speed (units/sec) for the QA hook. */
export function debugCurSpeed(): number {
  return curSpeed;
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
function updateRoll(dt: number): boolean {
  const p = state.player;
  const g = state.grid;
  if (!p || !g || p.rollT < 0) return false;

  p.rollT += dt;

  // Roll body: apply eased velocity. After ROLL_DURATION we're in recovery
  // (rooted, vulnerable) until ROLL_DURATION + ROLL_RECOVERY, then done.
  if (p.rollT <= ROLL_DURATION) {
    const tau = p.rollT / ROLL_DURATION;
    const speed = ROLL_V0 * (1 - tau); // fast → slow
    const res = moveCircle(g, p.x, p.z, PLAYER_R, p.rollDirX * speed * dt, p.rollDirZ * speed * dt);
    p.x = res.x;
    p.z = res.z;

    // i-frames only for the front window — top up the shared guard so it never
    // stacks with a separate damage-i-frame window.
    if (p.rollT < ROLL_IFRAMES) {
      p.iframes = Math.max(p.iframes, ROLL_IFRAMES - p.rollT);
    }
    // A little dust as the tumble scuffs the floor.
    state.vfx?.dust(p.x, 0.05, p.z);
  }

  if (p.rollT >= ROLL_DURATION + ROLL_RECOVERY) {
    p.rollT = -1;
    p.anim.play("idle", { force: true });
  }

  syncActorMesh(p);
  return true;
}

function rangedSfx(id: string): void {
  if (id === "gun") sfxGun();
  else if (id === "bow") sfxBow();
  else sfxFlame();
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

  // ── Dodge-roll ── it owns the player while active: no attack, no free
  // movement, direction committed. A tap starts one; the roll then runs to
  // completion (body + recovery) before normal control returns.
  if (input.consumeDodge()) tryStartRoll(input);
  if (updateRoll(dt)) return;

  const w = WEAPONS[activeWeapon().id];
  const ranged = w.kind === "ranged";

  // ── Melee attack timeline (windup → active → recovery), driven by p.move ──
  // Ranged weapons keep their own instant-fire path below; only melee uses the
  // phase machine. The active window fires the hit ONCE, scaled by the move.
  let attacking = p.attackT >= 0;
  if (attacking && !ranged && p.move) {
    p.attackT += dt;
    p.comboWindowT = Math.max(0, p.comboWindowT - dt);
    const m = p.move;
    const activeStart = m.windup;
    const activeEnd = m.windup + m.active;
    if (!p.didHit && p.attackT >= activeStart && p.attackT <= activeEnd) {
      p.didHit = true;
      resolvePlayerAttack({ damageMul: m.damageMul, arcMul: m.arcMul, rangeMul: m.rangeMul, knockbackMul: m.knockbackMul });
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

  // Sprint (hold Shift): a higher top speed that DRAINS stamina, gated only by
  // the bar — no cooldown. Can't sprint mid-swing, with an empty bar, or while
  // standing still. Draining here (not via spendStamina, which pauses regen for
  // half a second) keeps sprint's stamina bleeding smooth, and the moment you
  // stop sprinting the normal regen-delay applies from the last drain frame.
  const wantSprint = input.sprintHeld() && moving && !attacking && p.stamina > 0;
  if (wantSprint) {
    p.stamina = Math.max(0, p.stamina - SPRINT_DRAIN * dt);
    // Suppress regen for the full delay while sprinting — otherwise tickStamina
    // (which ran earlier this frame) refills faster than the drain and the bar
    // never falls. Refreshing the delay each sprint frame keeps regen paused
    // until STAMINA_REGEN_DELAY after you STOP sprinting.
    p.staminaRegenDelay = STAMINA_REGEN_DELAY;
  }

  // Target speed for this frame, then ramp the smoothed speed toward it so a
  // sprint spools up over ~0.15s instead of snapping to full velocity.
  let targetSpeed = PLAYER_SPEED * (attacking ? ATTACK_MOVE_FACTOR : 1);
  if (state.gear.boots !== undefined) targetSpeed *= BOOTS_SPEED_FACTOR;
  if (p.hasteT > 0) targetSpeed *= HASTE_SPEED_MULT; // haste potion: run faster
  if (wantSprint) targetSpeed *= SPRINT_SPEED_MULT;
  if (!moving) targetSpeed = 0;

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
    p.anim.play(moving ? "walk" : "idle");
  }

  // ── Trigger ──
  if (ranged) {
    // Ranged is unchanged: fire the instant the trigger pulls, only gated by
    // cooldown (the flamethrower re-fires many times per fire animation).
    if (input.consumeAttack() && p.cooldown <= 0) {
      p.attackT = 0;
      p.move = null;
      p.cooldown = w.cooldown * (p.hasteT > 0 ? HASTE_COOLDOWN_MULT : 1);
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
  if (held && p.chargeT >= CHARGE_TIME && canStartSwing) {
    p.chargeT = -1; // consumed; won't also fire a light on release
    p.attackBufferT = 0;
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
