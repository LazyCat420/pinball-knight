/**
 * Run scoring for the leaderboard.
 *
 * Kept out of `core.ts` so the formula is readable and testable on its own —
 * `core.ts` is ~1900 lines and a scoring rule buried in it is a rule nobody can
 * find or tune.
 *
 * DEPTH DOMINATES. Pinball Knight is a descent: the run's whole goal is to get
 * further down, and death restarts at floor 1. A leaderboard that ranked on
 * kills or gold would reward farming a safe early floor, which is the opposite
 * of the intended pressure (the Death Dealer exists precisely to stop that).
 * One extra floor is therefore worth more than any amount of grinding on the
 * floor above it.
 *
 * The other terms are tiebreakers between runs that reached the same depth:
 * combo rewards playing it as a pinball table rather than walking it, kills
 * reward clearing rather than sprinting past, gold is the smallest nudge.
 */

/** One floor deeper beats any amount of farming on the floor above. */
export const SCORE_PER_FLOOR = 1000;
/** Style: the bounce combo is the pinball skill axis. */
export const SCORE_PER_COMBO = 50;
/** Clearing rather than sprinting past. */
export const SCORE_PER_KILL = 25;
/** Smallest nudge — gold is already its own reward via the wallet. */
export const SCORE_PER_GOLD = 1;

export interface RunStats {
  /** Deepest floor REACHED (1-based), not the floor cleared. */
  deepestFloor: number;
  /** Best bounce combo across the whole run, not per floor. */
  bestCombo: number;
  kills: number;
  /** Gold earned this run. */
  gold: number;
  /** Wall-clock seconds for the run. */
  durationS: number;
}

/**
 * Score a finished run. Always >= 0 — a floor-1 death with nothing to show
 * still scores `SCORE_PER_FLOOR`, because reaching floor 1 is the floor.
 */
export function scoreRun(s: RunStats): number {
  return Math.max(
    0,
    Math.round(
      s.deepestFloor * SCORE_PER_FLOOR +
        s.bestCombo * SCORE_PER_COMBO +
        s.kills * SCORE_PER_KILL +
        s.gold * SCORE_PER_GOLD,
    ),
  );
}

/**
 * The `detail` blob stored alongside the score.
 *
 * The service keeps this as JSON with a 2000-byte cap, so it stays small and
 * flat — enough to render a leaderboard row that explains itself ("floor 7,
 * ×14 combo") without a second request.
 */
export function runDetail(s: RunStats): Record<string, unknown> {
  return {
    floor: s.deepestFloor,
    combo: s.bestCombo,
    kills: s.kills,
    gold: s.gold,
    seconds: Math.round(s.durationS),
  };
}
