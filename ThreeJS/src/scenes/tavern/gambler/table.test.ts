/**
 * House-rule tests.
 *
 * This module is the only thing allowed to move gold, so it is the only place a
 * gambling bug can actually cost the player real currency. Worth being thorough:
 * an off-by-one in the round limit is an infinite gold faucet, and a payout that
 * forgets the stake silently halves every win.
 */
import { describe, it, expect } from "vitest";
import {
  MIN_STAKE,
  MAX_STAKE_ABS,
  ROUNDS_PER_VISIT,
  maxStake,
  clampStake,
  stakeOptions,
  canBet,
  placeBet,
  settle,
  roundsLeft,
  rtp,
  createTableState,
  type TableDeps,
  type RoundResult,
} from "./table";

/** A fake purse, so the rules can be tested without a real wallet. */
function fakeWallet(start: number): TableDeps & { balance: number } {
  const w = {
    balance: start,
    getBalance: () => w.balance,
    spendGold: (n: number) => {
      if (w.balance < n) return false;
      w.balance -= n;
      return true;
    },
    addGold: (n: number) => {
      w.balance += n;
      return w.balance;
    },
  };
  return w;
}

const result = (over: Partial<RoundResult> = {}): RoundResult => ({
  game: "slots",
  stake: 10,
  payout: 0,
  label: "TEST",
  ...over,
});

describe("stake limits", () => {
  it("caps at half the purse, so one pull can't nuke a run", () => {
    expect(maxStake(40)).toBe(20);
  });

  it("caps absolutely, so a deep run can't trivialise the shop", () => {
    expect(maxStake(9000)).toBe(MAX_STAKE_ABS);
  });

  it("reports 0 for a purse that can't cover the minimum", () => {
    expect(maxStake(MIN_STAKE - 1)).toBe(0);
  });

  it("never returns a max below the minimum for a playable purse", () => {
    // A purse of exactly MIN_STAKE would give floor(5/2)=2 by the fraction
    // alone, which is an illegal bet. The floor at MIN_STAKE prevents offering it.
    expect(maxStake(MIN_STAKE)).toBe(MIN_STAKE);
  });

  it("clamps a requested stake into the legal band", () => {
    expect(clampStake(999, 40)).toBe(20);
    expect(clampStake(1, 40)).toBe(MIN_STAKE);
    expect(clampStake(12.7, 400)).toBe(12);
  });

  it("only offers stake steps the purse can actually cover", () => {
    expect(stakeOptions(40)).toEqual([5, 10]);
    expect(stakeOptions(1000)).toEqual([5, 10, 25, 50, 100]);
    expect(stakeOptions(2)).toEqual([]);
  });
});

describe("canBet", () => {
  it("allows a legal bet", () => {
    expect(canBet(createTableState(), 100, 25).ok).toBe(true);
  });

  it("refuses once the visit's rounds are used up", () => {
    const t = createTableState();
    t.roundsPlayed = ROUNDS_PER_VISIT;
    const c = canBet(t, 100, 10);
    expect(c.ok).toBe(false);
    expect(c.reason).toBe("closed");
  });

  it("refuses a purse under the minimum", () => {
    expect(canBet(createTableState(), 2, 5).reason).toBe("too-poor");
  });

  it("refuses a stake over the table limit", () => {
    expect(canBet(createTableState(), 40, 30).reason).toBe("bad-stake");
  });

  it("refuses nonsense stakes", () => {
    expect(canBet(createTableState(), 100, NaN).ok).toBe(false);
    expect(canBet(createTableState(), 100, Infinity).ok).toBe(false);
    expect(canBet(createTableState(), 100, -10).ok).toBe(false);
  });
});

describe("placing and settling", () => {
  it("takes the stake up front, so a loss is visible", () => {
    const w = fakeWallet(100);
    const t = createTableState();
    expect(placeBet(t, w, 25).ok).toBe(true);
    // The gold is gone BEFORE the game resolves — a purse that merely fails to
    // grow doesn't read as a loss.
    expect(w.balance).toBe(75);
  });

  it("a loss returns nothing", () => {
    const w = fakeWallet(100);
    const t = createTableState();
    placeBet(t, w, 25);
    settle(t, w, result({ stake: 25, payout: 0 }));
    expect(w.balance).toBe(75);
    expect(t.net).toBe(-25);
  });

  it("a push returns exactly the stake", () => {
    const w = fakeWallet(100);
    const t = createTableState();
    placeBet(t, w, 25);
    settle(t, w, result({ stake: 25, payout: 25 }));
    expect(w.balance).toBe(100);
    expect(t.net).toBe(0);
  });

  it("payout INCLUDES the stake — a 3x win nets 2x", () => {
    // The bug this guards: treating payout as profit silently halves every win.
    const w = fakeWallet(100);
    const t = createTableState();
    placeBet(t, w, 25);
    settle(t, w, result({ stake: 25, payout: 75 }));
    expect(w.balance).toBe(150); // 100 - 25 + 75
    expect(t.net).toBe(50);
  });

  it("counts exactly one round per settle", () => {
    const w = fakeWallet(500);
    const t = createTableState();
    placeBet(t, w, 10);
    settle(t, w, result());
    expect(t.roundsPlayed).toBe(1);
    expect(roundsLeft(t)).toBe(ROUNDS_PER_VISIT - 1);
  });

  it("the round limit actually stops play — no infinite faucet", () => {
    const w = fakeWallet(10000);
    const t = createTableState();
    let placed = 0;
    for (let i = 0; i < 50; i++) {
      if (!placeBet(t, w, 10).ok) break;
      placed++;
      settle(t, w, result({ stake: 10, payout: 40 })); // always winning
    }
    expect(placed).toBe(ROUNDS_PER_VISIT);
    expect(roundsLeft(t)).toBe(0);
  });

  it("refuses to place a bet the purse cannot cover", () => {
    const w = fakeWallet(8);
    const t = createTableState();
    // 8g purse -> max stake 5. Ask for 5, which is legal, then try again broke.
    expect(placeBet(t, w, 5).ok).toBe(true);
    expect(w.balance).toBe(3);
    expect(placeBet(t, w, 5).ok).toBe(false);
  });

  it("keeps the log bounded", () => {
    const w = fakeWallet(100000);
    const t = createTableState();
    for (let i = 0; i < 30; i++) settle(t, w, result());
    expect(t.log.length).toBeLessThanOrEqual(8);
  });
});

describe("rtp", () => {
  it("is 1 when every round pushes", () => {
    expect(rtp([result({ stake: 10, payout: 10 }), result({ stake: 20, payout: 20 })])).toBe(1);
  });

  it("is 0 when every round loses", () => {
    expect(rtp([result({ stake: 10, payout: 0 })])).toBe(0);
  });

  it("weights by stake, not by round count", () => {
    // One big loss and one small win is NOT a 50% return.
    const r = rtp([result({ stake: 100, payout: 0 }), result({ stake: 10, payout: 20 })]);
    expect(r).toBeCloseTo(20 / 110, 5);
  });

  it("returns 0 rather than NaN for an empty sample", () => {
    expect(rtp([])).toBe(0);
  });
});
