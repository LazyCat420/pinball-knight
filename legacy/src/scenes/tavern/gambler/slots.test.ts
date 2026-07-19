/**
 * Slots tuning tests.
 *
 * The RTP assertion here is the whole point of the file. The first version of
 * this paytable looked entirely reasonable — five skulls on the strip, a 40×
 * jackpot — and enumerated to a **13% RTP**: the player would have lost 87% of
 * every coin. Nothing about reading the table suggested that. Payout maths has
 * to be computed, and then pinned, or it silently drifts into either a tax or a
 * money printer.
 */
import { describe, it, expect } from "vitest";
import { spin, score, exactRtp, REEL_STRIP, PAYTABLE, ANY_PAIR_PAY, TWO_JACKPOT_PAY, type Symbol } from "./slots";

/** Deterministic PRNG so a Monte-Carlo run is reproducible. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("RTP", () => {
  it("pays back close to 90% by full enumeration", () => {
    const r = exactRtp();
    expect(r).toBeGreaterThan(0.86);
    expect(r).toBeLessThan(0.94);
  });

  it("NEVER pays over 100% — the house must win on average", () => {
    // Above 1.0 the slot machine becomes the optimal way to buy cards, and both
    // the shop and the boss-drop economy stop mattering.
    expect(exactRtp()).toBeLessThan(1);
  });

  it("a Monte-Carlo run agrees with the enumeration", () => {
    // Confirms the sampler actually draws from the strip the maths assumes —
    // an off-by-one in `spin`'s index would show up here and nowhere else.
    const rand = seeded(12345);
    let staked = 0;
    let returned = 0;
    for (let i = 0; i < 200000; i++) {
      staked += 10;
      returned += spin(rand).multiplier * 10;
    }
    expect(returned / staked).toBeCloseTo(exactRtp(), 1);
  });
});

describe("scoring", () => {
  it("pays three of a kind by the paytable", () => {
    expect(score(["jackpot", "jackpot", "jackpot"]).multiplier).toBe(PAYTABLE.jackpot);
    expect(score(["ball", "ball", "ball"]).multiplier).toBe(PAYTABLE.ball);
  });

  it("three skulls pays nothing", () => {
    const s = score(["skull", "skull", "skull"]);
    expect(s.multiplier).toBe(0);
    expect(s.label).toContain("SKULL");
  });

  it("two jackpots pays the consolation, in any position", () => {
    expect(score(["jackpot", "jackpot", "ball"]).multiplier).toBe(TWO_JACKPOT_PAY);
    expect(score(["jackpot", "ball", "jackpot"]).multiplier).toBe(TWO_JACKPOT_PAY);
    expect(score(["ball", "jackpot", "jackpot"]).multiplier).toBe(TWO_JACKPOT_PAY);
  });

  it("two jackpots beats the plain any-pair rate", () => {
    expect(TWO_JACKPOT_PAY).toBeGreaterThan(ANY_PAIR_PAY);
  });

  it("pays any pair, in any position", () => {
    expect(score(["ball", "ball", "target"]).multiplier).toBe(ANY_PAIR_PAY);
    expect(score(["ball", "target", "ball"]).multiplier).toBe(ANY_PAIR_PAY);
    expect(score(["target", "ball", "ball"]).multiplier).toBe(ANY_PAIR_PAY);
  });

  it("names the symbol that actually paired", () => {
    // The label drives the player-facing message; naming the wrong symbol is
    // the kind of thing nobody notices until it reads as a bug.
    expect(score(["target", "ball", "ball"]).label).toContain("BALL");
    expect(score(["ball", "target", "target"]).label).toContain("TARGET");
  });

  it("pays nothing for three different symbols", () => {
    expect(score(["ball", "bumper", "target"]).multiplier).toBe(0);
  });

  it("a skull pair still pays — only the TRIPLE is worthless", () => {
    expect(score(["skull", "skull", "ball"]).multiplier).toBe(ANY_PAIR_PAY);
  });
});

describe("the reel strip", () => {
  it("keeps the jackpot to exactly one stop", () => {
    expect(REEL_STRIP.filter((s) => s === "jackpot")).toHaveLength(1);
  });

  it("shows the jackpot on the reel rather than hiding it", () => {
    // Present but rare is what creates the near-miss; absent would remove it.
    expect(REEL_STRIP).toContain("jackpot");
  });

  it("has every symbol the paytable prices", () => {
    for (const sym of Object.keys(PAYTABLE) as Symbol[]) {
      expect(REEL_STRIP, `"${sym}" is priced but never appears`).toContain(sym);
    }
  });
});

describe("symbol art", () => {
  it("every symbol on the strip has pixel art", async () => {
    // A missing painter throws at DRAW time — i.e. mid-spin, with the player's
    // gold already taken. Cheap to assert here instead.
    const { paintedSymbols } = await import("./symbols");
    const painted = new Set(paintedSymbols());
    for (const s of new Set(REEL_STRIP)) {
      expect(painted.has(s), `"${s}" is on the reel but has no art`).toBe(true);
    }
  });
});

describe("spin", () => {
  it("only ever produces symbols from the strip", () => {
    const rand = seeded(7);
    for (let i = 0; i < 2000; i++) {
      for (const s of spin(rand).reels) expect(REEL_STRIP).toContain(s);
    }
  });

  it("is deterministic for a given seed", () => {
    expect(spin(seeded(42)).reels).toEqual(spin(seeded(42)).reels);
  });

  it("agrees with `score` on its own reels", () => {
    const rand = seeded(99);
    for (let i = 0; i < 500; i++) {
      const out = spin(rand);
      expect(out.multiplier).toBe(score(out.reels).multiplier);
    }
  });
});
