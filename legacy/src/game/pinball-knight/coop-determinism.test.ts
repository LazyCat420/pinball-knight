/**
 * CO-OP DETERMINISM — the invariant that keeps a shared floor shared.
 *
 * Every peer generates the horde LOCALLY from the pool's shared seed; a zombie's
 * sub-type is DERIVED from the spawn hash and never transmitted (see
 * `Zombie.ztype` in state.ts). So the whole co-op contract for sub-types reduces
 * to one property: identical inputs must give identical sub-types, forever.
 *
 * Testing this in a browser is not practical — two clients walk different paths
 * through the tavern before descending and drain `Math.random` at different
 * rates, so their runSeeds diverge before a floor is ever built. The invariant
 * that actually matters is the pure one, and it is testable exactly.
 */
import { describe, it, expect } from "vitest";
import { pickZombieType, ZOMBIE_TYPES, ZOMBIE_TYPE_IDS } from "./zombie-types";

/** The hash `spawnHordeMember` derives per spawn tile, reproduced faithfully. */
function spawnHashes(runSeed: number, level: number, n: number): number[] {
  // mulberry32, the generator core.ts seeds each floor with.
  let a = (runSeed ^ (level * 0x9e3779b9)) >>> 0;
  const rng = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: n }, () => (rng() * 0xffffffff) | 0);
}

describe("co-op: two peers on one seed agree on every zombie's sub-type", () => {
  it("derives an identical sub-type sequence for the same (seed, floor)", () => {
    for (const seed of [1, 42, 0x7ffffffe, 123456789, 987654321]) {
      for (const level of [1, 3, 5, 9]) {
        const peerA = spawnHashes(seed, level, 400).map((h) => pickZombieType(h, level));
        const peerB = spawnHashes(seed, level, 400).map((h) => pickZombieType(h, level));
        expect(peerB, `seed ${seed} floor ${level} diverged`).toEqual(peerA);
      }
    }
  });

  it("gives DIFFERENT seeds different hordes (the test above isn't vacuous)", () => {
    const a = spawnHashes(1, 5, 400).map((h) => pickZombieType(h, 5));
    const b = spawnHashes(2, 5, 400).map((h) => pickZombieType(h, 5));
    expect(a).not.toEqual(b);
  });

  it("is a PURE function of (hash, level) — no hidden state between calls", () => {
    // A generator that advanced internal state per call would drift a peer that
    // spawned its horde in a different order (e.g. packs before the sweep).
    const hashes = spawnHashes(555, 6, 200);
    const forward = hashes.map((h) => pickZombieType(h, 6));
    const backward = [...hashes].reverse().map((h) => pickZombieType(h, 6)).reverse();
    expect(backward).toEqual(forward);
    // …and re-asking for one in isolation gives the same answer.
    for (let i = 0; i < hashes.length; i += 37) {
      expect(pickZombieType(hashes[i], 6)).toBe(forward[i]);
    }
  });

  it("never yields a depth-gated sub-type on a shallow floor, for any seed", () => {
    for (const seed of [7, 99, 0x5f3759df]) {
      for (let level = 1; level <= 6; level++) {
        for (const t of spawnHashes(seed, level, 300).map((h) => pickZombieType(h, level))) {
          expect(ZOMBIE_TYPES[t].fromLevel).toBeLessThanOrEqual(level);
        }
      }
    }
  });

  it("uses the whole roster across a run, so peers must agree on all of them", () => {
    const seen = new Set<string>();
    for (let level = 1; level <= 9; level++) {
      for (const t of spawnHashes(31337, level, 500).map((h) => pickZombieType(h, level))) seen.add(t);
    }
    expect(seen.size).toBe(ZOMBIE_TYPE_IDS.length);
  });
});
