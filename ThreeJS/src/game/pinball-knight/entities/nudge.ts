/**
 * THE NUDGE, AND THE TILT — shoving the table, and being punished for it.
 *
 * The other thing a pinball player does with their hands. The flipper button
 * (entities/flippers.ts) is the half you aim with; this is the half that makes
 * the machine a physical object you are fighting rather than a level you are
 * inside. A table you cannot shove is furniture.
 *
 * ## The binding, and why it needed no new key
 *
 * SHIFT on the keyboard, LT on a pad — the sprint modifier — plus a direction,
 * while momentum is live.
 *
 * That is free, on both devices, and it was the only thing that was. Every
 * other key is spoken for (Space is dodge AND the plunger pull AND the lane
 * change, the mouse owns attack and aim, Q/E are abilities, R rampage, 1-4 the
 * belt, Tab the swap, M the map, F the flipper) and the pad has no unbound
 * button left at all after B went to the flipper.
 *
 * Sprint is genuinely inert while riding: `input.sprintHeld()` is read at
 * exactly one place in entities/player.ts, in the WALKING path, after
 * `updatePinball` has already returned. A knight travelling as a ball cannot
 * sprint, so the modifier means nothing there — and "shove harder" is a good
 * meaning to give it.
 *
 * ## Why a nudge is not just more steering
 *
 * The momentum ride already bends toward the stick continuously
 * (`PINBALL_STEER`). If a nudge were only a bigger version of that it would be
 * a strictly better steer and nobody would ever not hold it.
 *
 * So it is an IMPULSE with a price. One nudge rotates the heading by a fixed
 * `NUDGE_BEND` and adds a little speed — sharper than the steer can ever be —
 * and it costs `TILT_PER_NUDGE` of a meter that only drains with time. Three
 * inside the window and the table TILTS: momentum dead, combo gone, shot chain
 * cleared, and a lockout during which shoving does nothing at all.
 *
 * That is the real mechanic. A nudge is not a control, it is a loan.
 */
import { state } from "../state";
import {
  NUDGE_BEND,
  NUDGE_SPEED_ADD,
  NUDGE_COOLDOWN,
  PINBALL_MAX_SPEED,
  TILT_PER_NUDGE,
  TILT_DECAY,
  TILT_WARN,
  TILT_LOCKOUT,
} from "../constants";
import { requestShake } from "../engine/juice";
import { showPickupNote, showToast } from "../ui";
import { clearShotChain } from "../shots";
import { sfxBumper, sfxHurt } from "../sfx";

/**
 * How close the table is to tilting, 0..1. Module-local rather than a field on
 * `state`: nothing outside this file and its test needs to write it, and
 * state.ts is already past its size gate.
 */
let tilt = 0;
/** Seconds left of the post-tilt lockout, during which a shove does nothing. */
let lockT = 0;
/** Re-shove guard, so one held Shift is one nudge and not sixty a second. */
let coolT = 0;
/** True once this floor's warning has fired, so it is a warning and not a nag. */
let warned = false;

/** The live tilt meter, for the debug surface and any HUD that wants it. */
export function tiltLevel(): number {
  return tilt;
}

/** Seconds left of the tilt lockout — 0 when the table is playable. */
export function tiltLockRemaining(): number {
  return lockT;
}

/**
 * Drop every nudge-and-tilt clock. Called from `startLevel`.
 *
 * A tilt meter is FLOOR-scoped, like the frenzy meter and the orbit ledger it
 * sits beside. Carrying it down the stairs would mean a floor you have not
 * touched yet is already one shove from a penalty, which reads as the game
 * punishing you for something you did on a floor that no longer exists.
 */
export function resetTilt(): void {
  tilt = 0;
  lockT = 0;
  coolT = 0;
  warned = false;
}

/**
 * Age the meter. Called every frame from `updatePlayer`, alongside the flipper
 * clock and for the same reason: it is state that must drain whether or not the
 * player is currently in a state that can read input.
 */
export function updateTilt(dt: number): void {
  if (coolT > 0) coolT = Math.max(0, coolT - dt);
  if (lockT > 0) {
    lockT = Math.max(0, lockT - dt);
    if (lockT === 0) showPickupNote("↕️ table settled");
    return; // the meter does not drain while locked out — that IS the penalty
  }
  if (tilt > 0) tilt = Math.max(0, tilt - TILT_DECAY * dt);
}

/**
 * Shove the table.
 *
 * `dirX/dirZ` is the direction the player is pushing, already normalised and in
 * world space. Returns true if the shove actually landed — false when there is
 * no momentum to bend, the re-shove guard is up, or the table is locked out.
 */
export function nudgeTable(dirX: number, dirZ: number): boolean {
  const p = state.player;
  if (!p || p.momSpeed <= 0) return false; // nothing to shove
  if (lockT > 0 || coolT > 0) return false;
  if (dirX === 0 && dirZ === 0) return false;

  // Rotate the heading TOWARD the push by a fixed angle, rather than blending
  // toward it. A blend's effect depends on how far off the push already was —
  // shoving at 90° would move you further than shoving at 10°, which makes the
  // control feel different every time you use it. A fixed rotation is the same
  // shove every time, which is what a physical bump is.
  //
  // The SIGN is the short way round: `cross` is positive when the push lies to
  // the +z side of the heading, and the rotation below maps (1,0) → (cos a,
  // sin a), so a positive `a` turns toward +z. Getting this backwards shoves
  // you AWAY from where you pushed, which reads as broken controls rather than
  // as a wrong constant — `nudge.test.ts` asserts the heading ends up closer to
  // the push than it started, which is the only form of this that cannot pass
  // by accident.
  const cross = p.momX * dirZ - p.momZ * dirX;
  const sign = cross === 0 ? 1 : Math.sign(cross);
  const a = sign * NUDGE_BEND;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const nx = p.momX * c - p.momZ * s;
  const nz = p.momX * s + p.momZ * c;
  const l = Math.hypot(nx, nz) || 1;
  p.momX = nx / l;
  p.momZ = nz / l;
  p.momSpeed = Math.min(PINBALL_MAX_SPEED, p.momSpeed + NUDGE_SPEED_ADD);

  coolT = NUDGE_COOLDOWN;
  tilt = Math.min(1, tilt + TILT_PER_NUDGE);
  // The shake scales with the meter, so the table tells you how close you are
  // WITHOUT a HUD gauge — which is how a real machine does it too.
  requestShake(0.12 + 0.22 * tilt);
  state.vfx?.dust(p.x, 0.2, p.z);
  sfxBumper();

  if (tilt >= 1) {
    doTilt();
  } else if (tilt >= TILT_WARN && !warned) {
    warned = true;
    showPickupNote("⚠️ TILT WARNING");
  }
  return true;
}

/**
 * TILT. The table has had enough.
 *
 * The penalty is deliberately the COMBO and not gold or health. Gold would make
 * a nudge a purchase, and health would make it a hazard; losing the chain you
 * were building is the pinball-correct punishment, because the chain is exactly
 * what the nudge was trying to save.
 */
function doTilt(): void {
  const p = state.player;
  tilt = 1;
  lockT = TILT_LOCKOUT;
  if (p) {
    p.momSpeed = 0;
    p.bounceCombo = 0;
    p.bounceComboT = 0;
    state.vfx?.dust(p.x, 0.3, p.z);
  }
  state.partComboHits = 0;
  clearShotChain();
  requestShake(0.5);
  sfxHurt();
  showToast("🛑 TILT", "the table has had enough — combo lost");
}
