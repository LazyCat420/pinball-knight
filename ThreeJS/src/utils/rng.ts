/**
 * Seeded pseudo-random number generators.
 *
 * One canonical implementation, so a seed means the same stream everywhere.
 * The maze generator and the casino tests were each carrying a byte-identical
 * private copy of mulberry32 — three copies that had to stay in lockstep for
 * pinned test expectations to keep meaning anything.
 */

/**
 * Mulberry32 — fast 32-bit seeded PRNG, uniform in [0, 1).
 *
 * Deterministic for a given seed: the same seed replays the same sequence, which
 * is what lets the dungeon regenerate a level exactly and lets the Monte-Carlo
 * payout tests assert on real spins instead of mocking Math.random.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
