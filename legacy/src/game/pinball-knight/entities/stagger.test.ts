/**
 * STAGGER — the entropy accumulator, measured rather than described.
 *
 * The claim this file has to defend is not "there is a stagger" but three
 * numeric properties, each of which a plausible-looking implementation gets
 * wrong in a way you cannot see by reading it:
 *
 *  1. the LONG-RUN RATE equals the printed chance (a counter that zeroes on
 *     trigger instead of subtracting silently under-delivers);
 *  2. the VARIANCE is bounded — no streaks. This is the entire reason it is an
 *     accumulator and not a seeded die, and a seeded die would pass (1);
 *  3. it is DETERMINISTIC and free of hidden state, which is the co-op contract.
 *
 * Plus the momentum coupling: pain chance has to be a curve on `momentumT`,
 * because a binary "fast enough" gate is exactly the flatness DECLONE §1 exists
 * to remove.
 */
import { describe, it, expect } from "vitest";
import { painChance, staggerTime, accrue, PAIN_BY_KIND, type EntropyHolder } from "./stagger";
import { momentumT } from "./combo-curve";
import {
  STAGGER_SPEED_FLOOR,
  STAGGER_TIME_MIN,
  STAGGER_TIME_MAX,
  ENTROPY_FULL,
  PINBALL_MAX_SPEED,
  MOMENTUM_T_FLOOR,
} from "../constants";
import { KIND_IDS } from "../bestiary";

/** Fire `n` events at a fixed chance and report the trigger pattern. */
function stream(chance: number, n: number): boolean[] {
  const h: EntropyHolder = {};
  return Array.from({ length: n }, () => accrue(h, "painEntropy", chance));
}

/** The longest run of consecutive identical outcomes in a stream. */
function longestRun(xs: boolean[], of: boolean): number {
  let best = 0;
  let cur = 0;
  for (const x of xs) {
    cur = x === of ? cur + 1 : 0;
    if (cur > best) best = cur;
  }
  return best;
}

describe("the entropy accumulator delivers the printed rate", () => {
  it("hits the exact long-run rate for every chance, with no drift", () => {
    for (const p of [0.05, 0.1, 0.25, 0.4, 0.5, 0.65, 0.78, 0.9]) {
      const n = 10000;
      const hits = stream(p, n).filter(Boolean).length;
      // Within one event of exact — the only slack is the counter's remainder.
      expect(Math.abs(hits - p * n), `chance ${p}`).toBeLessThanOrEqual(1);
    }
  });

  it("SUBTRACTS the threshold instead of zeroing (the rate-eating bug)", () => {
    // A counter reset to 0 on trigger throws away the remainder, so a chance of
    // 0.6 would fire once every 2 events instead of 3 in every 5. This is the
    // assertion that catches it: 0.6 must give exactly 600 in 1000.
    expect(stream(0.6, 1000).filter(Boolean).length).toBe(600);
  });

  it("bounds the variance — no streaks in either direction", () => {
    // At 40%, i.i.d. dice give a run of 5+ misses roughly every 100 events and
    // it looks like the mechanic is broken. The accumulator makes the gap
    // between hits at most ⌈1/p⌉.
    const s = stream(0.4, 4000);
    expect(longestRun(s, false)).toBeLessThanOrEqual(Math.ceil(1 / 0.4));
    expect(longestRun(s, true)).toBeLessThanOrEqual(1);
  });

  it("fires every event at chance 1 and never banks a spare", () => {
    const s = stream(1, 50);
    expect(s.every(Boolean)).toBe(true);
    // A holder that banked overflow would fire once more on a zero-chance event.
    const h: EntropyHolder = {};
    for (let i = 0; i < 50; i++) accrue(h, "painEntropy", 1);
    expect(accrue(h, "painEntropy", 0)).toBe(false);
  });

  it("never fires on a zero or negative chance", () => {
    const h: EntropyHolder = {};
    for (let i = 0; i < 500; i++) {
      expect(accrue(h, "painEntropy", 0)).toBe(false);
      expect(accrue(h, "painEntropy", -1)).toBe(false);
    }
    expect(h.painEntropy ?? 0).toBe(0);
  });

  it("keeps the two counters independent", () => {
    // A shared stream would let a dodging sub-type starve its own stagger rate.
    const h: EntropyHolder = {};
    for (let i = 0; i < 20; i++) accrue(h, "dodgeEntropy", 0.5);
    expect(h.painEntropy ?? 0).toBe(0);
  });
});

describe("determinism — the co-op contract", () => {
  it("two peers accruing the same events agree, event for event", () => {
    for (const p of [0.13, 0.37, 0.78]) {
      expect(stream(p, 2000)).toEqual(stream(p, 2000));
    }
  });

  it("is a pure function of (counter, chance) — no module-level state", () => {
    // Interleaving two holders must not change either one's pattern, which is
    // what a shared counter or a module-scope RNG would break.
    const solo = stream(0.45, 200);
    const a: EntropyHolder = {};
    const b: EntropyHolder = {};
    const interleaved: boolean[] = [];
    for (let i = 0; i < 200; i++) {
      interleaved.push(accrue(a, "painEntropy", 0.45));
      accrue(b, "painEntropy", 0.9); // a second actor, hit at a different rate
    }
    expect(interleaved).toEqual(solo);
  });

  it("uses no Math.random anywhere in the stagger path", () => {
    // Belt and braces: freeze the global and run the whole surface.
    const real = Math.random;
    Math.random = () => {
      throw new Error("Math.random() on the horde path");
    };
    try {
      const h: EntropyHolder = {};
      for (let i = 0; i < 500; i++) accrue(h, "painEntropy", painChance(0.78, 14));
      staggerTime(11);
    } finally {
      Math.random = real;
    }
  });
});

describe("pain chance is a CURVE on momentum, not a gate", () => {
  it("is worth STAGGER_SPEED_FLOOR of the base at a standstill", () => {
    expect(painChance(0.8, 0)).toBeCloseTo(0.8 * STAGGER_SPEED_FLOOR, 6);
  });

  it("reaches the full base at terminal speed", () => {
    expect(painChance(0.8, PINBALL_MAX_SPEED)).toBeCloseTo(0.8, 6);
  });

  it("is strictly monotone between them — every extra unit of speed pays", () => {
    // The flatness DECLONE §1 exists to remove: a binary gate would give the
    // same number at 9 u/s and 21 u/s.
    let prev = -1;
    for (let v = MOMENTUM_T_FLOOR; v <= PINBALL_MAX_SPEED; v += 0.25) {
      const c = painChance(0.7, v);
      expect(c).toBeGreaterThan(prev);
      prev = c;
    }
  });

  it("tracks momentumT exactly, so speed means one thing everywhere", () => {
    for (const v of [0, 5, 8, 12, 16, 22, 40]) {
      const t = momentumT(v);
      expect(painChance(1, v)).toBeCloseTo(STAGGER_SPEED_FLOOR + (1 - STAGGER_SPEED_FLOOR) * t, 6);
    }
  });

  it("never leaves [0,1] however silly the inputs", () => {
    for (const base of [0, 0.5, 1, 4]) {
      for (const v of [-10, 0, 22, 1000]) {
        const c = painChance(base, v);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });

  it("stagger HOLDS LONGER at speed", () => {
    expect(staggerTime(0)).toBeCloseTo(STAGGER_TIME_MIN, 6);
    expect(staggerTime(PINBALL_MAX_SPEED)).toBeCloseTo(STAGGER_TIME_MAX, 6);
    expect(staggerTime(12)).toBeGreaterThan(staggerTime(6));
  });
});

describe("the pain roster is a real difficulty axis", () => {
  it("covers every EnemyKind (a missing row = an unstaggerable monster)", () => {
    for (const k of KIND_IDS) {
      expect(PAIN_BY_KIND[k], `no pain chance for "${k}"`).toBeTypeOf("number");
    }
    expect(Object.keys(PAIN_BY_KIND).sort()).toEqual([...KIND_IDS].sort());
  });

  it("ranks fodder far above elites — the whole point of the stat", () => {
    // Doom's reading: threat is f(speed, stun-resistance, geometry), not HP.
    expect(PAIN_BY_KIND.zombie).toBeGreaterThan(PAIN_BY_KIND.brute * 3);
    expect(PAIN_BY_KIND.bat).toBeGreaterThan(PAIN_BY_KIND.golem * 10);
    expect(PAIN_BY_KIND.golem).toBeLessThan(0.1); // masonry
  });

  it("MEASURED: fodder is ricochet-stunlockable at speed and elites are not", () => {
    // The quantity, not a proxy: how many hits out of 20 at terminal speed
    // actually interrupt. A zombie should be held; a brute should not.
    const hits = (base: number, v: number): number => {
      const h: EntropyHolder = {};
      let n = 0;
      for (let i = 0; i < 20; i++) if (accrue(h, "painEntropy", painChance(base, v))) n++;
      return n;
    };
    expect(hits(PAIN_BY_KIND.zombie, PINBALL_MAX_SPEED)).toBeGreaterThanOrEqual(15);
    expect(hits(PAIN_BY_KIND.brute, PINBALL_MAX_SPEED)).toBeLessThanOrEqual(4);
    // …and at a walk, almost nothing is staggered by anything.
    expect(hits(PAIN_BY_KIND.zombie, 0)).toBeLessThanOrEqual(3);
  });

  it("leaves the unstaggerable unstaggerable at any speed", () => {
    for (const k of ["reaper", "pin"] as const) {
      const h: EntropyHolder = {};
      for (let i = 0; i < 500; i++) {
        expect(accrue(h, "painEntropy", painChance(PAIN_BY_KIND[k], PINBALL_MAX_SPEED))).toBe(false);
      }
    }
  });

  it("ENTROPY_FULL is only a scale — the rate is unit-free", () => {
    // Documents that the 100 is arbitrary: chance × ENTROPY_FULL over
    // ENTROPY_FULL is chance, whatever the constant is set to.
    expect(stream(0.5, 1000).filter(Boolean).length).toBe(500);
    expect(ENTROPY_FULL).toBeGreaterThan(0);
  });
});
