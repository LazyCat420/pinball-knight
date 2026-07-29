/**
 * The one deterministic stream per (run, level).
 *
 * This expression was written out by hand in **thirteen** places — `core.ts`
 * plus twelve test files — before it was given a home. That is a silent-desync
 * factory in a game with co-op: every peer derives its floor from
 * `(runSeed, level)`, so if the production copy is edited and a test's copy is
 * not, the test keeps passing against its own stale arithmetic while two
 * players walk different mazes. Nothing else would catch it — the suite is
 * green, the floor renders, and the desync only shows up as "the door is a wall
 * on my screen".
 *
 * So: **one function, imported by both sides.** If you are changing the mix,
 * change it here and every peer and every test moves together.
 *
 * The constant is the golden-ratio odd 32-bit word (2^32/φ) — the standard
 * choice for this kind of avalanche because multiplying by it spreads a small
 * incrementing `level` across the whole word before it is XORed into the run
 * seed. Consecutive floors of one run therefore look unrelated, which is the
 * property the maze generator wants.
 */
import { mulberry32 } from "../../../utils/rng";

/** 2^32 / φ, odd — the golden-ratio avalanche constant. */
const GOLDEN32 = 0x9e3779b9;

/**
 * The seed for one floor of one run.
 *
 * Deliberately NOT a hash of a string: it must be reproducible from two numbers
 * that every peer already agrees on, with no ordering or encoding subtleties.
 */
export function floorSeed(runSeed: number, level: number): number {
  return (runSeed ^ (level * GOLDEN32)) >>> 0;
}

/**
 * The floor's RNG, ready to draw from.
 *
 * Prefer this over `mulberry32(floorSeed(...))` at call sites — a caller that
 * builds the generator itself is one refactor away from seeding it with
 * something else, which is the failure this module exists to prevent.
 */
export function floorRng(runSeed: number, level: number): () => number {
  return mulberry32(floorSeed(runSeed, level));
}
