/**
 * DARTS — "The Board". The one game here decided by execution rather than odds.
 *
 * Scoring is a real dartboard, simplified: 12 wedges instead of 20, because at
 * pixel scale 20 wedges are 18° each and indistinguishable. Rings are standard —
 * double on the outer, treble on the middle band, two bulls at the centre.
 *
 * Pure and geometric: `scoreAt` takes a normalised hit position and returns what
 * it's worth, so the entire scoring surface is testable without a canvas. The
 * renderer paints the board by asking `scoreAt` what colour each pixel is, so
 * the board you see IS the scoring function — they cannot drift apart.
 *
 * ── Why there is now a little RNG, and why that is not a betrayal ────────────
 * The original build had none at all: lock X, lock Y, the dart appears exactly
 * there. That is pure, and it is also the bug — the sweep started from the same
 * place at the same speed every single throw, so the "skill" was memorising one
 * timing, after which treble-20 landed a hundred times out of a hundred. A game
 * whose skill ceiling is reached and then never moves again is not a skill game,
 * it is a password.
 *
 * So a throw now scatters inside a small disc around where you locked — the
 * knight's hand, three ales in. It is BOUNDED (`wobbleRadius` is a hard cap, not
 * a standard deviation), so the dart always lands visibly near where you aimed
 * and the game can never look like it lied to you. And it scales with the stake
 * and with the dart number, which is what finally gives the board a risk/reward
 * axis: see `wobbleRadius`.
 *
 * ── The economy, which was broken ───────────────────────────────────────────
 * See PAYOUT_BANDS. The old curve topped out at 6× and was reachable by a
 * player who had learned the one timing, which made this station worth ~3000g a
 * visit against a floor income of 80–200g. The curve below is derived from the
 * visit limit instead of eyeballed.
 */

import { clamp } from "../../../utils/math";
import { MIN_STAKE, MAX_STAKE_ABS } from "./table";

/** Wedge values clockwise from the top. Ordered so neighbours differ wildly —
 * that adjacency is what punishes a near miss on a real board. */
export const WEDGES = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19];

export const WEDGE_COUNT = WEDGES.length;

/** Ring radii as a fraction of the board radius, outermost first. */
export const R_OUTER = 1.0; // beyond this = miss
export const R_DOUBLE_IN = 0.88; // double ring: 0.88 .. 1.0
export const R_TREBLE_OUT = 0.58;
export const R_TREBLE_IN = 0.48; // treble ring: 0.48 .. 0.58
export const R_OUTER_BULL = 0.14;
export const R_BULL = 0.06;

export type HitRing = "miss" | "single" | "double" | "treble" | "outer-bull" | "bull";

export interface Hit {
  ring: HitRing;
  /** Wedge value, or 0 for the bulls and a miss. */
  wedge: number;
  points: number;
  label: string;
}

/**
 * Score a throw.
 *
 * `x`/`y` are offsets from the board centre in units of the board RADIUS, so
 * (0,0) is the bullseye and anything with |v| > 1 is off the board entirely.
 */
export function scoreAt(x: number, y: number): Hit {
  const r = Math.hypot(x, y);

  if (r > R_OUTER) return { ring: "miss", wedge: 0, points: 0, label: "MISS" };
  if (r <= R_BULL) return { ring: "bull", wedge: 0, points: 50, label: "BULLSEYE" };
  if (r <= R_OUTER_BULL) return { ring: "outer-bull", wedge: 0, points: 25, label: "OUTER BULL" };

  // Wedge index, measured clockwise from straight up.
  const ang = Math.atan2(x, -y); // 0 = up, +ve clockwise
  const norm = (ang + Math.PI * 2) % (Math.PI * 2);
  const idx = Math.floor((norm / (Math.PI * 2)) * WEDGE_COUNT + 0.5) % WEDGE_COUNT;
  const wedge = WEDGES[idx];

  if (r >= R_DOUBLE_IN) return { ring: "double", wedge, points: wedge * 2, label: `DOUBLE ${wedge}` };
  if (r >= R_TREBLE_IN && r <= R_TREBLE_OUT) return { ring: "treble", wedge, points: wedge * 3, label: `TREBLE ${wedge}` };
  return { ring: "single", wedge, points: wedge, label: `${wedge}` };
}

/** Darts thrown per round. */
export const DARTS_PER_ROUND = 3;

/**
 * Payout for a three-dart total, as a stake multiplier (stake included).
 *
 * ── Where these numbers come from ───────────────────────────────────────────
 * The binding constraint is `table.ts`: ROUNDS_PER_VISIT = 6 and
 * MAX_STAKE_ABS = 100, so the most a player can put through this station in one
 * tavern visit is 6 × 100 = 600g. The tavern is entered once per floor and a
 * floor yields 80–200g (GAMBLER_PLAN.md), so the profit a MASTER extracts per
 * visit is the only number that matters:
 *
 *     profit_per_visit = 600 × (RTP − 1)
 *
 * The old curve topped out at 6× for 120+, and 120+ was reachable every single
 * round once you had the timing (three treble-20s is 180). That is RTP 6.0:
 *
 *     600 × (6.0 − 1) = +3000g per visit — about 21 floors' income, per floor.
 *
 * Even the merely-good 4× band gave 600 × 3 = +1800g, which buys the 600g
 * mythic three times over. The station was a faucet, exactly as `table.ts`
 * warned darts would be.
 *
 * The target instead: a player who has genuinely mastered the hardest game in
 * the house should earn about ONE extra floor's income per floor for it —
 * meaningful, and not run-defining.
 *
 *     +150g on 600g staked  ⇒  RTP ≈ 1.25
 *
 * So the design budget is **perfect-timing RTP in [1.05, 1.35]**, asserted by a
 * Monte-Carlo in `darts.test.ts` that plays an optimal aimer at max stake. The
 * bands below were FITTED to that measurement, not chosen by eye — four curves
 * were sampled at 120k rounds each and this one is the fit.
 *
 * Measured (120k rounds per cell, optimal aim, `wobbleRadius` as shipped):
 *
 *     stake   aiming treble-20      aiming the safe fat 20     profit / visit
 *       5g    2.000×                1.000×  (exactly a push)   +30g
 *      25g    1.566×                0.874×                     +85g
 *      50g    1.417×                —                          +125g
 *     100g    1.286×                0.573×                     +172g
 *
 * and a REALISTIC player — optimal aim plus ±0.15 of timing error — measures
 * 1.003× at max stake. That is the shape the whole design wanted: an ordinary
 * player breaks even, a master takes about one floor's income per floor, and
 * the ceiling is +172g rather than the +3000g it was.
 *
 * Read the two columns against each other, because that is the risk/reward the
 * board never used to have. Playing SAFE — three fat 20s for 60 — is exactly a
 * push at a small stake and a real loss at a big one, because at 100g your hand
 * shakes too much to even hold the fat ring. Going for trebles is the only way
 * to profit, and it is also the only way to bust. "Keep your money" and "make
 * money" are finally different buttons.
 *
 * Note the ceiling is now 2.0× rather than 6×. That is not meanness: the reward
 * for skill here is that darts is the only positive-RTP game in the casino at
 * all, which the 90% slots and 94.7% roulette are not. The multiplier only has
 * to be big enough to feel like a win.
 */
export const PAYOUT_BANDS: Array<{ min: number; mult: number; label: string }> = [
  { min: 155, mult: 2.0, label: "MASTERFUL" },
  { min: 120, mult: 1.55, label: "EXCELLENT" },
  { min: 90, mult: 1.2, label: "STRONG" },
  { min: 55, mult: 1, label: "PUSH" },
  { min: 0, mult: 0, label: "POOR" },
];

export function payoutFor(total: number): { mult: number; label: string } {
  for (const band of PAYOUT_BANDS) {
    if (total >= band.min) return { mult: band.mult, label: band.label };
  }
  return { mult: 0, label: "POOR" };
}

/**
 * The sweep speed for a stake, in sweeps per second.
 *
 * The bigger the bet, the faster the bar — so risk is something you feel in
 * your hands rather than a number you read. This is the best idea in the whole
 * casino and the reason darts is the game worth the most polish.
 */
export function sweepSpeed(stake: number): number {
  // 5g -> ~0.85/s, 100g -> ~2.0/s. Log-ish so the low end stays learnable.
  return 0.8 + Math.log10(Math.max(1, stake)) * 0.6;
}

/**
 * How much faster the sweep runs on dart `i` of the round (0-based).
 *
 * The third dart is the one that decides the band, so it is the fastest. This
 * is the cheapest possible way to stop a round being three identical throws:
 * a rhythm you have locked onto by dart two stops working on dart three.
 */
export function dartSpeedRamp(i: number): number {
  return 1 + 0.22 * Math.max(0, i);
}

/** Sweep speed actually used for dart `i` of a round at this stake. */
export function throwSpeed(stake: number, dartIndex: number): number {
  return sweepSpeed(stake) * dartSpeedRamp(dartIndex);
}

/**
 * The radius of the disc a throw scatters into — the unsteady hand.
 *
 * HARD BOUND, not a sigma: the dart cannot land further than this from where
 * you locked, so it always lands visibly near your aim. An unbounded gaussian
 * would occasionally fling a dart across the board and read as the game
 * cheating, which is far worse than it being slightly easy.
 *
 * Scaled by stake AND by dart number, and the scaling is where the whole
 * risk/reward of the game lives. Compare against the bands in `scoreAt`:
 *
 *   treble ring half-width  = (0.58 − 0.48) / 2  = 0.050
 *   bullseye radius                              = 0.060
 *   the fat single ring     = 0.14 .. 0.48       ≈ 0.170 half-width
 *
 * At MIN_STAKE the wobble is 0.025–0.037: inside the treble band, so a small
 * bet is where you LEARN the throw and trebles are reliable. At MAX_STAKE_ABS
 * it is 0.120–0.180 — more than twice the treble half-width and three times the
 * bull — so at max stake going for treble-20 genuinely often will not stick.
 *
 * The fat single ring is 3.4× more forgiving than the treble band and is what
 * the safe line rides on. Note it does NOT fully absorb the wobble at max stake:
 * by the third dart 0.180 has just overrun the fat ring's 0.170 half-width, so
 * even playing safe starts leaking at 100g (measured RTP 0.573, against exactly
 * 1.000 at 5g). That is deliberate and it is the sharpest thing the stake does —
 * at a small stake safe play protects you, at a big one nothing does.
 *
 * It is also what stops the faucet, and it stops it in the right place. The
 * faucet only exists at max stake (six rounds is six rounds either way, so
 * profit scales with stake), and max stake is exactly where the hand is worst.
 * Interpolated between the two stake limits in LOG space, so the curve is
 * anchored to `table.ts` rather than to two magic numbers that will silently
 * stop meaning anything the first time someone edits the table.
 *
 * The first pass at this scaled far too gently — 0.023 at 5g rising to only
 * 0.066 at 100g. Measured, a perfect aimer at max stake still averaged 173 of a
 * possible 180, because the treble band is an ANNULUS: displacing a dart
 * radially by less than its half-width leaves it in the treble, and displacing
 * it sideways by 0.066 at r=0.53 is 7°, well inside a 30° wedge. The wobble has
 * to exceed the band it is supposed to threaten or it is decoration.
 */
export function wobbleRadius(stake: number, dartIndex: number): number {
  const lo = Math.log10(MIN_STAKE);
  const hi = Math.log10(MAX_STAKE_ABS);
  const t = clamp((Math.log10(Math.max(1, stake)) - lo) / (hi - lo), 0, 1);
  const base = WOBBLE_AT_MIN_STAKE + t * (WOBBLE_AT_MAX_STAKE - WOBBLE_AT_MIN_STAKE);
  return base * (1 + 0.25 * Math.max(0, dartIndex));
}

/** Scatter radius on the first dart of a MIN_STAKE round — tight, learnable. */
export const WOBBLE_AT_MIN_STAKE = 0.025;
/** Scatter radius on the first dart of a MAX_STAKE_ABS round — genuinely shaky. */
export const WOBBLE_AT_MAX_STAKE = 0.12;

/**
 * Apply the wobble to a locked aim point, returning where the dart lands.
 *
 * Uniform over the disc (radius ∝ √u, or throws would bunch at the centre and
 * the wobble would be decorative). `rng` is injected so tests are deterministic
 * and so the Monte-Carlo economy check can drive it.
 */
export function applyWobble(x: number, y: number, radius: number, rng: () => number): { x: number; y: number } {
  const ang = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, Math.min(1, rng()))) * radius;
  return { x: x + Math.cos(ang) * r, y: y + Math.sin(ang) * r };
}

/**
 * How far the Y sweep travels once X is locked, as a half-range.
 *
 * Derived from the chord of the board at that X rather than being a fixed ±1,
 * and this is a real fix rather than a nicety. With independent ±1 sweeps the
 * aim space is a SQUARE and the board is a CIRCLE, so locking X out near the
 * rim left almost every Y a miss — the player had thrown the dart away one
 * press before they had any way of knowing.
 *
 * Tying the range to the chord means every X lock stays playable, and it makes
 * the rim self-balancing: out by the double ring the window is short, so the
 * bar crosses it fast and the double is legitimately harder than the fat single
 * behind it. Slightly overshoots the chord so a miss is still possible.
 */
export function yHalfRange(x: number): number {
  const chord = Math.sqrt(Math.max(0, 1 - x * x));
  return Math.max(0.16, chord * 1.08 + 0.04);
}

/** How far past the rim the X sweep travels — enough that a bad lock can miss. */
export const X_SWEEP_AMPLITUDE = 1.06;

/** Highest achievable three-dart score, for sanity-checking the bands. */
export function maxRound(): number {
  return Math.max(...WEDGES) * 3 * DARTS_PER_ROUND;
}

/** The point a good player aims at: the centre of the treble-20 band. */
export const TREBLE_20 = { x: 0, y: -(R_TREBLE_IN + R_TREBLE_OUT) / 2 };

/** The point a cautious player aims at: the fat single-20, a huge target. */
export const SAFE_20 = { x: 0, y: -(R_OUTER_BULL + R_TREBLE_IN) / 2 };
