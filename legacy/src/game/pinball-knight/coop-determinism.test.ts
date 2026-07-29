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
import { accrue, painChance, PAIN_BY_KIND, type EntropyHolder } from "./entities/stagger";
import { PINBALL_MAX_SPEED } from "./constants";
import { floorSeed } from "./maze/floor-seed";

/** The hash `spawnHordeMember` derives per spawn tile, reproduced faithfully. */
function spawnHashes(runSeed: number, level: number, n: number): number[] {
  // mulberry32, the generator core.ts seeds each floor with.
  let a = floorSeed(runSeed, level);
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

/**
 * The SECOND co-op invariant, added with the stagger economy (DECLONE §6.1):
 * every peer must agree on WHO IS STAGGERED, not just on who is a hulk.
 *
 * Stagger is decided per impact by a pain roll, and a pain roll is exactly the
 * kind of thing that would normally be `Math.random() < chance` — which on four
 * peers simulating the same floor means four different monsters frozen at four
 * different moments, and a knight who is safe on one screen and bitten on
 * another. The fix is the same shape as the sub-type hash: replace the roll
 * with something that has no randomness in it at all.
 *
 * PoE's entropy accumulator (entities/stagger.ts) does that AND removes streaks
 * as a side effect. What has to be pinned here is that it is a pure function of
 * (counter, chance): no module state, no clock, no draw order dependence.
 */
describe("co-op: two peers agree on every stagger", () => {
  /** Replay a peer's whole hit stream and record which hits interrupted. */
  function peer(chances: number[]): boolean[] {
    const z: EntropyHolder = {};
    return chances.map((c) => accrue(z, "painEntropy", c));
  }

  /** A plausible fight: impacts at wildly varying speeds against one monster. */
  function fight(seed: number, n: number): number[] {
    // Speeds from a mulberry32 so the SEQUENCE is fixed but not uniform —
    // an accumulator that only worked for a constant chance would pass a
    // constant-rate test and fail here.
    let a = seed >>> 0;
    const rng = (): number => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return Array.from({ length: n }, () => painChance(PAIN_BY_KIND.zombie, rng() * PINBALL_MAX_SPEED));
  }

  it("derives an identical stagger sequence from an identical hit sequence", () => {
    for (const seed of [1, 42, 123456789]) {
      const chances = fight(seed, 500);
      expect(peer(chances), `seed ${seed} diverged`).toEqual(peer(chances));
    }
  });

  it("gives DIFFERENT fights different staggers (the test above isn't vacuous)", () => {
    expect(peer(fight(1, 500))).not.toEqual(peer(fight(2, 500)));
  });

  it("carries no state between actors — two monsters can't share a stream", () => {
    // A module-level counter would make monster B's stagger depend on how many
    // times monster A had been hit, which desyncs the moment two peers kill the
    // horde in a different order.
    const chances = fight(7, 300);
    const solo = peer(chances);
    const a: EntropyHolder = {};
    const b: EntropyHolder = {};
    const interleaved = chances.map((c) => {
      accrue(b, "painEntropy", 0.9);
      return accrue(a, "painEntropy", c);
    });
    expect(interleaved).toEqual(solo);
  });

  it("has zero Math.random on the path, even with the global booby-trapped", () => {
    const real = Math.random;
    Math.random = () => {
      throw new Error("Math.random() reached the stagger path");
    };
    try {
      peer(fight(99, 400));
    } finally {
      Math.random = real;
    }
  });

  it("delivers each monster's PRINTED pain chance over a long fight", () => {
    // Determinism is worthless if it is deterministically wrong: at terminal
    // speed the rate must be the family's own number, not a rounded-down one.
    for (const kind of ["zombie", "brute", "bat", "golem"] as const) {
      const n = 4000;
      const c = painChance(PAIN_BY_KIND[kind], PINBALL_MAX_SPEED);
      const hits = peer(Array.from({ length: n }, () => c)).filter(Boolean).length;
      expect(Math.abs(hits - c * n), kind).toBeLessThanOrEqual(1);
    }
  });
});
