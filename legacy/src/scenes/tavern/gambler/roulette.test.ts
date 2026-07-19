/**
 * Roulette pricing tests.
 *
 * The property that matters: EVERY bet on the table returns the same 18/19. A
 * single mispriced `pays` is invisible in play — the game looks fine, and a
 * player who happens to favour that bet quietly farms the house. Enumerating
 * all 19 pockets per bet is cheap and catches it exactly.
 */
import { describe, it, expect } from "vitest";
import {
  BETS,
  POCKETS,
  WHEEL_NUMBERS,
  colorOf,
  wins,
  settleBet,
  straightBet,
  spinWheel,
  exactRtp,
  thirdRange,
} from "./roulette";

const EXPECTED_RTP = WHEEL_NUMBERS / POCKETS; // 18/19

describe("pricing", () => {
  it("every table bet returns exactly 18/19", () => {
    for (const b of BETS) {
      expect(exactRtp(b), `"${b.label}" is mispriced`).toBeCloseTo(EXPECTED_RTP, 10);
    }
  });

  it("a straight-up on any number returns 18/19 too", () => {
    for (let n = 0; n < POCKETS; n++) {
      expect(exactRtp(straightBet(n)), `straight ${n} is mispriced`).toBeCloseTo(EXPECTED_RTP, 10);
    }
  });

  it("no bet ever returns 100% or more", () => {
    for (const b of [...BETS, ...Array.from({ length: POCKETS }, (_, n) => straightBet(n))]) {
      expect(exactRtp(b)).toBeLessThan(1);
    }
  });

  it("lands on the real single-zero house edge", () => {
    // ~5.26% — the number a physical single-zero wheel has.
    expect((1 - EXPECTED_RTP) * 100).toBeCloseTo(5.26, 1);
  });
});

describe("the wheel", () => {
  it("has 19 pockets: zero plus 1-18", () => {
    expect(POCKETS).toBe(19);
  });

  it("colours zero green and alternates the rest", () => {
    expect(colorOf(0)).toBe("green");
    expect(colorOf(1)).toBe("red");
    expect(colorOf(2)).toBe("black");
    expect(colorOf(17)).toBe("red");
    expect(colorOf(18)).toBe("black");
  });

  it("splits red and black evenly", () => {
    let red = 0;
    let black = 0;
    for (let n = 1; n <= WHEEL_NUMBERS; n++) colorOf(n) === "red" ? red++ : black++;
    expect(red).toBe(black);
  });

  it("only ever produces a real pocket", () => {
    for (let i = 0; i < 5000; i++) {
      const n = spinWheel();
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(POCKETS);
      expect(Number.isInteger(n)).toBe(true);
    }
  });
});

describe("zero is the house's edge, and behaves like it", () => {
  it("loses every even-money bet", () => {
    expect(wins({ kind: "color", color: "red" }, 0)).toBe(false);
    expect(wins({ kind: "color", color: "black" }, 0)).toBe(false);
    expect(wins({ kind: "parity", odd: true }, 0)).toBe(false);
    // Zero is EVEN as an integer — treating it as such would hand the player a
    // free even-money win and wipe out the entire house edge.
    expect(wins({ kind: "parity", odd: false }, 0)).toBe(false);
    expect(wins({ kind: "half", high: false }, 0)).toBe(false);
    expect(wins({ kind: "third", index: 0 }, 0)).toBe(false);
  });

  it("still pays a straight-up bet on zero", () => {
    expect(wins({ kind: "straight", n: 0 }, 0)).toBe(true);
  });
});

describe("bet coverage", () => {
  it("halves split the numbers evenly and don't overlap", () => {
    let low = 0;
    let high = 0;
    for (let n = 1; n <= WHEEL_NUMBERS; n++) {
      const l = wins({ kind: "half", high: false }, n);
      const h = wins({ kind: "half", high: true }, n);
      expect(l && h, `${n} is in both halves`).toBe(false);
      expect(l || h, `${n} is in neither half`).toBe(true);
      if (l) low++;
      else high++;
    }
    expect(low).toBe(high);
  });

  it("thirds tile the wheel exactly once each", () => {
    for (let n = 1; n <= WHEEL_NUMBERS; n++) {
      const hits = ([0, 1, 2] as const).filter((i) => wins({ kind: "third", index: i }, n));
      expect(hits, `${n} is covered by ${hits.length} thirds`).toHaveLength(1);
    }
  });

  it("thirds cover 1-6, 7-12, 13-18", () => {
    expect(thirdRange(0)).toEqual([1, 6]);
    expect(thirdRange(1)).toEqual([7, 12]);
    expect(thirdRange(2)).toEqual([13, 18]);
  });
});

describe("settleBet", () => {
  it("names the pocket and the bet in the result", () => {
    const r = settleBet(BETS.find((b) => b.id === "red")!, 1);
    expect(r.multiplier).toBe(2);
    expect(r.label).toContain("1");
    expect(r.label).toContain("RED");
  });

  it("calls a zero out by name", () => {
    expect(settleBet(BETS[0], 0).label).toContain("ZERO");
  });

  it("pays a straight-up 18x, stake included", () => {
    expect(settleBet(straightBet(7), 7).multiplier).toBe(18);
  });
});
