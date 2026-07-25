/**
 * BANKED RAILS — the inside-curve ride you have to earn.
 *
 * The ask, verbatim from the playtest: *"like a NASCAR driver scraping the
 * sidewall to get faster speed... Hot Wheels mixed with pinball mixed with
 * Sonic the Hedgehog"*, and then two follow-ups that pin the design down:
 * **"you have to earn it"** and **"rail exceeds cap until you get off"**.
 *
 * So this is deliberately NOT the existing one-shot systems:
 *
 *   · KICKER RUBBER (arc-kickers) throws you OFF a convex wall. One impulse.
 *   · BOOSTER LANE (arc-lanes) carries you along a face. One impulse, on entry.
 *   · A RAIL is a STATE you hold. Every frame you keep yourself pressed into
 *     the banked inside wall, you accelerate — and you keep accelerating past
 *     the speed the rest of the game can reach.
 *
 * ── Why the inside (concave) face ─────────────────────────────────────────
 *
 * On a concave sweep the ball sits INSIDE the circle and the wall banks around
 * it — the racing line, the cup, the Sonic loop. A convex sweep is a rounded
 * corner bulging into the room; you glance off its outside. Rubber belongs
 * there. Putting the accelerating ride on the outside bulge (which is what
 * shipped first) reads backwards to anyone who has seen a real table or a real
 * racetrack, which is exactly the report that prompted this.
 *
 * ── The three rules ───────────────────────────────────────────────────────
 *
 * 1. **Earned.** Contact is not enough. `holdStrength` requires the player's
 *    own input to point INTO the wall. Let go and `RAIL_GRACE` seconds later
 *    you are off. This is the difference between a skill and a conveyor belt.
 * 2. **Over-cap.** While held, speed may climb to `PINBALL_MAX_SPEED *
 *    RAIL_OVERSPEED`. Without this a long arc saturates the normal cap in a
 *    heartbeat and the ride stops reading as acceleration at all.
 * 3. **It decays, it is not confiscated.** Leaving does not snap you back to
 *    the cap — you carry the overspeed and bleed it at `RAIL_DECAY`, so the
 *    exit is a payoff you spend down the next straight.
 *
 * Pure maths: no THREE, no DOM, no state import. Everything arrives as
 * arguments so the whole thing is unit-testable, which matters because "how
 * fast does this feel" is otherwise only answerable on a real monitor.
 */
import {
  RAIL_ACCEL,
  RAIL_MIN_SPEED,
  RAIL_HOLD_DOT,
  RAIL_GRACE,
  RAIL_OVERSPEED,
  RAIL_DECAY,
  PINBALL_MAX_SPEED,
} from "../constants";

/** Live rail state, carried on the player between frames. */
export interface RailState {
  /** Feature index of the arc being ridden, or -1 when not railing. */
  featureIdx: number;
  /** Seconds since the hold was last satisfied — drives the grace window. */
  slipT: number;
  /** Seconds on this rail, for FX ramping and scoring. */
  rideT: number;
}

export function freshRail(): RailState {
  return { featureIdx: -1, slipT: 0, rideT: 0 };
}

/** The ceiling while railing. Everything else in the game caps at
 *  PINBALL_MAX_SPEED; this is the only way past it. */
export function railCap(): number {
  return PINBALL_MAX_SPEED * RAIL_OVERSPEED;
}

/**
 * How hard the player is holding INTO the wall, 0..1.
 *
 * `inward` is the unit vector from the ball toward the arc centre (on a concave
 * face that is "into the bank"). `steerX/steerZ` is the player's raw input, not
 * their velocity — that distinction is the whole "earn it" rule. Using velocity
 * would mean the curve holds you automatically, since travelling along a
 * circle already points slightly inward.
 *
 * Returns 0 when there is no input at all, so coasting drops the rail.
 */
export function holdStrength(steerX: number, steerZ: number, inX: number, inZ: number): number {
  const len = Math.hypot(steerX, steerZ);
  if (len < 1e-4) return 0;
  const dot = (steerX / len) * inX + (steerZ / len) * inZ;
  return dot <= 0 ? 0 : dot;
}

/** Is the hold good enough to keep the rail this frame? */
export function holdsRail(strength: number): boolean {
  return strength >= RAIL_HOLD_DOT;
}

export interface RailStep {
  /** Speed after this frame's acceleration (or unchanged if not railing). */
  speed: number;
  /** True while the rail is engaged — drives sparks, sfx and the HUD tell. */
  riding: boolean;
  /** True on the frame the rail is lost, so callers can fire an exit flourish. */
  released: boolean;
}

/**
 * Advance one frame of railing.
 *
 * `contact` is whether the ball is within the sticky band of a rail face this
 * frame; `strength` is `holdStrength` for that face. Both are computed by the
 * caller, which owns the geometry — this function owns only the rules.
 *
 * The grace window is why `slipT` exists: a player mid-corner will wobble off
 * the ideal line for a frame or two, and dropping them instantly would make
 * long arcs feel like they punish commitment rather than reward it.
 */
export function stepRail(rail: RailState, contact: boolean, strength: number, speed: number, dt: number): RailStep {
  const wasRiding = rail.featureIdx >= 0;

  if (contact && holdsRail(strength)) {
    rail.slipT = 0;
  } else if (wasRiding) {
    rail.slipT += dt;
  }

  // Losing it: no contact at all, or the grace window elapsed, or too slow to
  // hold a line. The speed floor stops a crawling ball from "railing" a wall it
  // is merely leaning on.
  const lost = !contact || rail.slipT > RAIL_GRACE || speed < RAIL_MIN_SPEED;
  if (wasRiding && lost) {
    rail.featureIdx = -1;
    rail.slipT = 0;
    rail.rideT = 0;
    return { speed, riding: false, released: true };
  }
  if (!wasRiding) return { speed, riding: false, released: false };

  rail.rideT += dt;
  // Accelerate along the bank, up to the over-cap. Scaled by how well the line
  // is held, so a lazy lean gains less than a committed one — the skill
  // gradient the "earn it" rule asks for.
  const next = Math.min(railCap(), speed + RAIL_ACCEL * strength * dt);
  return { speed: next, riding: true, released: false };
}

/** Try to CATCH a rail this frame. Separate from stepRail so the caller can
 *  gate catching (speed, cooldowns) without duplicating the hold rules. */
export function tryCatchRail(rail: RailState, featureIdx: number, strength: number, speed: number): boolean {
  if (rail.featureIdx >= 0) return false;
  if (speed < RAIL_MIN_SPEED) return false;
  if (!holdsRail(strength)) return false;
  rail.featureIdx = featureIdx;
  rail.slipT = 0;
  rail.rideT = 0;
  return true;
}

/**
 * Bleed overspeed back toward the normal cap once off the rail.
 *
 * Deliberately gentle: the carried speed IS the reward, and snapping it away
 * at the exit would make the whole ride pointless. Anything at or under the
 * normal cap is untouched, so this never interferes with ordinary pinball.
 */
export function decayOverspeed(speed: number, dt: number): number {
  if (speed <= PINBALL_MAX_SPEED) return speed;
  return Math.max(PINBALL_MAX_SPEED, speed - RAIL_DECAY * dt);
}
