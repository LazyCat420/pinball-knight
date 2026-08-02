/**
 * THE SWEEP AXIS — which depths a whole-floor test actually needs.
 *
 * ── The measurement ────────────────────────────────────────────────────────
 *
 * Test sweeps here grew as hand-picked level lists: `[1,2,3,4,5,6,7,8,9,10,13,
 * 17,20,21,25,30,40]`, `[1..8,10,13,17,20,25]`, `[1,4,8,12,17,22]`. They look
 * like they cover depth. They do not — they oversample one region and
 * re-measure a constant everywhere else.
 *
 * `levelConfig` over L1-40 yields **24 distinct outcomes, and L24-L40 are
 * byte-identical**. Every budget saturates:
 *
 *   lamps L6 · secrets L7 · braid L7 · prefabs L7 · torches L8 · hazards L8
 *   rooms L9 · zombies L10 · item rarity L11 · parts L11 · speed L11
 *   launchBreaks L17 · grid width L23 · grid height L24
 *
 * From L24 on, only the boss's HP changes, and no floor-generation test reads
 * it. So `[20, 21, 25, 30, 40]` is five builds of what is nearly one floor
 * config — differing only in archetype, which is `ARCHETYPES[(level-1) % 5]`.
 *
 * ── What actually varies ───────────────────────────────────────────────────
 *
 * Two independent axes, and every sweep here is really a cross of them:
 *
 *  1. **ARCHETYPE** — 5 of them, on a modulo-5 cycle. The real variety: track
 *     layout, lane scale, plaza fraction, perimeter bias, surface bands. This
 *     is the axis whole-floor defects have historically lived on, which is why
 *     the rollups in every census are `byArchetype`.
 *  2. **BUDGET REGIME** — small/sparse (L1-5, grid 37x26 to 48x34) versus
 *     saturated (L24+, grid 96x72, every budget at its cap). The interesting
 *     failures are at the ENDS: a floor too small to fit the thing being
 *     placed, or one big enough that a fixed cap stops scaling with it. The
 *     middle is interpolation.
 *
 * `SHALLOW` and `DEEP` each walk all five archetypes once, at one end of the
 * budget range apiece. Ten levels cover both axes completely. A seventeen-level
 * list covers them no better and costs 70% more.
 *
 * ── Using it ───────────────────────────────────────────────────────────────
 *
 * `SWEEP_LEVELS` is the default for a gate that wants "every kind of floor".
 * A test with a genuinely different question should still hand-pick — this is
 * a default, not a rule, and a sweep that means something specific (the
 * fallback generator, a depth-gated mechanic) should say so locally rather
 * than borrow this and drift.
 *
 * ⚠️ If a budget's cap MOVES, `DEEP` must still sit past every cap. It is
 * pinned by `sweep-axis.test.ts`, which re-derives the saturation point from
 * `levelConfig` itself rather than trusting the list above.
 */
import { ARCHETYPES } from "./archetypes";

/**
 * The level at which every `levelConfig` budget has saturated.
 *
 * 24 is where `cellsH` reaches its 72 cap, the last field to move. Verified
 * against `levelConfig` by the test rather than asserted here, so a tuning
 * change that pushes a cap deeper fails loudly instead of silently making
 * `DEEP` a mid-range sample.
 */
export const SATURATION_LEVEL = 24;

/** One level per archetype at the SMALL end — grids 37x26 up to 48x34. */
export const SHALLOW: readonly number[] = ARCHETYPES.map((_, k) => k + 1);

/**
 * One level per archetype at the SATURATED end.
 *
 * Starts at `SATURATION_LEVEL` so every budget is pinned; the five consecutive
 * levels then walk the archetype cycle exactly once.
 */
export const DEEP: readonly number[] = ARCHETYPES.map((_, k) => SATURATION_LEVEL + k);

/** Both ends: all five archetypes, at both budget regimes. */
export const SWEEP_LEVELS: readonly number[] = [...SHALLOW, ...DEEP];

/**
 * Run seeds for a whole-floor sweep.
 *
 * Seeds are the cheap axis — they re-roll theme, modifier and every rng draw
 * without changing the floor's size — so breadth belongs here rather than in
 * the level list. Same four every census uses, so a failing test and a census
 * row can be compared directly.
 */
export const SWEEP_SEEDS: readonly number[] = [1, 12345, 987654321, 424242];

/**
 * ── COST LIVES IN AREA, NOT IN THE NUMBER OF LEVELS ────────────────────────
 *
 * A saturated floor is 96x72 cells against a shallow one's 37x26 — SEVEN times
 * the area — and `buildTrackFloor` is 96.5% of a whole-floor sweep's runtime
 * (measured in `piece-rules.test.ts`). So a sweep's cost is very nearly "how
 * many DEEP floors did you build", and the level count barely matters.
 *
 * Measured the hard way: replacing the old hand-picked lists with `SHALLOW +
 * DEEP` at uniform seed depth left `floor-rules` at 69→71s and pushed
 * `piece-rules` 39→46s. Fewer floors, more expensive ones, no saving —
 * better coverage bought at full price.
 *
 * `sweepPairs` fixes that by spending seeds where floors are cheap. Both
 * regimes and all five archetypes are still covered; the saturated end just
 * does not get re-rolled six times, because its job is "does this hold when
 * every budget is pinned and the grid is at its ceiling", and that question is
 * answered by a couple of seeds per archetype rather than by breadth.
 */
export const DEEP_SEED_SHARE = 2;

/**
 * Every (level, seed) pair a whole-floor sweep should build.
 *
 * `deepSeeds` exists because two DIFFERENT kinds of test share this axis and
 * they need different sample sizes:
 *
 *  · a PASS/FAIL gate ("no floor breaks this rule") is satisfied by coverage —
 *    every archetype at both ends — and a thin deep sample is enough;
 *  · a RATE gate ("this escape hatch fires on under X% of floors") is a
 *    statistic, and a thin sample makes it noise. Measured: the same
 *    `boss-has-room-to-fight` relaxation reads 6.7% over 30 deep floors and
 *    20% over 10. The second number is not a regression, it is three floors.
 *
 * So a rate gate passes `deepSeeds: seeds` and pays for it; everything else
 * takes the default and does not.
 */
export function sweepPairs(
  seeds: readonly number[] = SWEEP_SEEDS,
  opts: { deepSeeds?: readonly number[] } = {},
): ReadonlyArray<{ level: number; seed: number }> {
  const deep = opts.deepSeeds ?? seeds.slice(0, DEEP_SEED_SHARE);
  const out: { level: number; seed: number }[] = [];
  for (const level of SHALLOW) for (const seed of seeds) out.push({ level, seed });
  for (const level of DEEP) for (const seed of deep) out.push({ level, seed });
  return out;
}
