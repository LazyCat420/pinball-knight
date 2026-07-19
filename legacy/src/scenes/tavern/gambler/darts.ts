/**
 * DARTS — "The Board". Pure execution, no RNG in the outcome at all.
 *
 * The only game here you can actually beat, which is why it is priced hardest:
 * the payout curve is steep rather than generous, and the six-round visit limit
 * (table.ts) is what stops a good player farming it. A skilled player SHOULD
 * profit — that's the whole point of the house-edge gradient — but slowly, and
 * capped per floor.
 *
 * Scoring is a real dartboard, simplified: 12 wedges instead of 20, because at
 * pixel scale 20 wedges are 18° each and indistinguishable. Rings are standard —
 * double on the outer, treble on the middle band, two bulls at the centre.
 *
 * Pure and geometric: `scoreAt` takes a normalised hit position and returns what
 * it's worth, so the entire scoring surface is testable without a canvas.
 */

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
 * Steep on purpose. Three treble-20s is 180 and the theoretical max, but a
 * realistic good round is 60–100. The curve is set so that landing in the
 * single ring three times (~30) is a LOSS, an average round pushes, and only
 * genuinely good throwing profits.
 */
export const PAYOUT_BANDS: Array<{ min: number; mult: number; label: string }> = [
  { min: 120, mult: 6, label: "MASTERFUL" },
  { min: 100, mult: 4, label: "EXCELLENT" },
  { min: 75, mult: 2.5, label: "STRONG" },
  { min: 50, mult: 1.5, label: "DECENT" },
  { min: 30, mult: 1, label: "PUSH" },
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

/** Highest achievable three-dart score, for sanity-checking the bands. */
export function maxRound(): number {
  return Math.max(...WEDGES) * 3 * DARTS_PER_ROUND;
}
