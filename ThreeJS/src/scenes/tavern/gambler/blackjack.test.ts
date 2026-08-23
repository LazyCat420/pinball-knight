/**
 * Blackjack rule tests.
 *
 * Two things are being pinned here. First, hand scoring — ace demotion is the
 * classic place this goes wrong, and a hand mis-scored by 10 is a payout paid to
 * the wrong person. Second, the RTP, measured by SIMULATING basic strategy over
 * many hands: unlike slots and roulette there is no closed form, so the only
 * honest way to know these rules land near 98% is to play them.
 */
import { describe, it, expect } from "vitest";
import {
  freshDeck,
  shuffle,
  handValue,
  isBlackjack,
  settleHand,
  dealerShouldHit,
  cardValue,
  rankLabel,
  simulateHand,
  basicStrategy,
  type Card,
} from "./blackjack";
import { mulberry32 } from "../../../utils/rng";

const c = (rank: number, suit: Card["suit"] = "spades"): Card => ({ rank, suit });

/** Deterministic PRNG so a simulated shoe replays identically. */
const seeded = mulberry32;

describe("the deck", () => {
  it("has 52 unique cards", () => {
    const deck = freshDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((x) => `${x.rank}${x.suit}`)).size).toBe(52);
  });

  it("shuffles without losing or duplicating a card", () => {
    const shuffled = shuffle(freshDeck(), seeded(5));
    expect(shuffled).toHaveLength(52);
    expect(new Set(shuffled.map((x) => `${x.rank}${x.suit}`)).size).toBe(52);
  });

  it("actually changes the order", () => {
    const a = freshDeck();
    const b = shuffle(a, seeded(9));
    expect(b.map((x) => `${x.rank}${x.suit}`)).not.toEqual(a.map((x) => `${x.rank}${x.suit}`));
  });
});

describe("card values", () => {
  it("counts faces as ten", () => {
    expect(cardValue(11)).toBe(10);
    expect(cardValue(12)).toBe(10);
    expect(cardValue(13)).toBe(10);
    expect(cardValue(10)).toBe(10);
  });

  it("counts an ace as eleven before demotion", () => {
    expect(cardValue(1)).toBe(11);
  });

  it("labels ranks the way a card face reads", () => {
    expect(rankLabel(1)).toBe("A");
    expect(rankLabel(11)).toBe("J");
    expect(rankLabel(13)).toBe("K");
    expect(rankLabel(7)).toBe("7");
  });
});

describe("hand value — ace demotion", () => {
  it("scores a simple hard hand", () => {
    expect(handValue([c(9), c(7)]).total).toBe(16);
  });

  it("counts a lone ace as eleven, and calls it soft", () => {
    const v = handValue([c(1), c(6)]);
    expect(v.total).toBe(17);
    expect(v.soft).toBe(true);
  });

  it("demotes an ace to avoid a bust", () => {
    const v = handValue([c(1), c(6), c(10)]);
    expect(v.total).toBe(17);
    expect(v.soft).toBe(false);
  });

  it("demotes only as far as needed — A+A+9 is 21, not 12 or 31", () => {
    // The subtle one. Demoting every ace up front gives 11; demoting none gives
    // 31. Both are wrong, and both look plausible in code.
    const v = handValue([c(1), c(1), c(9)]);
    expect(v.total).toBe(21);
  });

  it("handles four aces", () => {
    expect(handValue([c(1), c(1), c(1), c(1)]).total).toBe(14);
  });

  it("busts when it must", () => {
    const v = handValue([c(10), c(9), c(5)]);
    expect(v.total).toBe(24);
    expect(v.bust).toBe(true);
  });

  it("21 is not a bust", () => {
    expect(handValue([c(10), c(5), c(6)]).bust).toBe(false);
  });
});

describe("blackjack detection", () => {
  it("is exactly two cards totalling 21", () => {
    expect(isBlackjack([c(1), c(13)])).toBe(true);
  });

  it("is NOT three cards making 21", () => {
    // Pays 2x, not 2.5x — getting this wrong quietly overpays every such hand.
    expect(isBlackjack([c(7), c(7), c(7)])).toBe(false);
  });
});

describe("dealer policy", () => {
  it("hits below 17", () => {
    expect(dealerShouldHit([c(10), c(6)])).toBe(true);
  });

  it("stands on hard 17", () => {
    expect(dealerShouldHit([c(10), c(7)])).toBe(false);
  });

  it("stands on SOFT 17 too — the house rule here", () => {
    expect(dealerShouldHit([c(1), c(6)])).toBe(false);
  });
});

describe("settlement", () => {
  it("a player bust loses even though the dealer never draws", () => {
    // The asymmetry that IS blackjack's house edge: acting first is a liability.
    expect(settleHand([c(10), c(9), c(5)], [c(10), c(6)]).multiplier).toBe(0);
  });

  it("pays a natural 3:2", () => {
    expect(settleHand([c(1), c(13)], [c(10), c(9)]).multiplier).toBe(2.5);
  });

  it("pushes when both have a natural", () => {
    expect(settleHand([c(1), c(13)], [c(1), c(12)]).multiplier).toBe(1);
  });

  it("a dealer natural beats a non-natural 21", () => {
    expect(settleHand([c(7), c(7), c(7)], [c(1), c(10)]).multiplier).toBe(0);
  });

  it("pays 2x on a dealer bust", () => {
    expect(settleHand([c(10), c(8)], [c(10), c(6), c(9)]).multiplier).toBe(2);
  });

  it("pays 2x on the higher total", () => {
    expect(settleHand([c(10), c(10)], [c(10), c(9)]).multiplier).toBe(2);
  });

  it("pushes on equal totals", () => {
    expect(settleHand([c(10), c(9)], [c(10), c(9)]).multiplier).toBe(1);
  });

  it("loses to the higher dealer total", () => {
    expect(settleHand([c(10), c(7)], [c(10), c(9)]).multiplier).toBe(0);
  });
});

describe("basic strategy", () => {
  it("stands on hard 17 or better", () => {
    expect(basicStrategy([c(10), c(7)], c(10), false)).toBe("stand");
  });

  it("always hits 11 or lower when it can't double", () => {
    expect(basicStrategy([c(5), c(4)], c(10), false)).toBe("hit");
  });

  it("doubles 11", () => {
    expect(basicStrategy([c(6), c(5)], c(6), true)).toBe("double");
  });

  it("stands stiff hands against a weak dealer card", () => {
    expect(basicStrategy([c(10), c(3)], c(5), false)).toBe("stand");
  });

  it("hits stiff hands against a strong dealer card", () => {
    expect(basicStrategy([c(10), c(3)], c(10), false)).toBe("hit");
  });

  it("never doubles once the hand is past its first decision", () => {
    expect(basicStrategy([c(6), c(5)], c(6), false)).not.toBe("double");
  });
});

describe("card art", () => {
  it("every suit has a hand-drawn pip", async () => {
    // A missing pip throws at DRAW time — mid-hand, with the bet already down.
    const { paintedSuits } = await import("./cards-art");
    const painted = new Set(paintedSuits());
    for (const card of freshDeck()) {
      expect(painted.has(card.suit), `"${card.suit}" has no pip`).toBe(true);
    }
  });
});

describe("RTP under basic strategy", () => {
  it("lands near 98% — the target for the skill game", () => {
    // No closed form here, so the rules are measured by playing them. 200k hands
    // keeps the sampling noise well under the band being asserted.
    const rand = seeded(20260719);
    let wagered = 0;
    let returned = 0;
    for (let i = 0; i < 200000; i++) {
      const r = simulateHand(rand);
      wagered += r.wagered;
      returned += r.multiplier;
    }
    const rtp = returned / wagered;
    expect(rtp).toBeGreaterThan(0.95);
    expect(rtp).toBeLessThan(1.0);
  });

  it("NEVER pays over 100% — the house must still win", () => {
    // If decent play beat this game, blackjack would become the optimal way to
    // buy cards and both the shop and the boss-drop economy would stop mattering.
    const rand = seeded(777);
    let wagered = 0;
    let returned = 0;
    for (let i = 0; i < 120000; i++) {
      const r = simulateHand(rand);
      wagered += r.wagered;
      returned += r.multiplier;
    }
    expect(returned / wagered).toBeLessThan(1.0);
  });

  it("beats the other games' returns — skill should pay best", () => {
    const rand = seeded(31337);
    let wagered = 0;
    let returned = 0;
    for (let i = 0; i < 120000; i++) {
      const r = simulateHand(rand);
      wagered += r.wagered;
      returned += r.multiplier;
    }
    // Slots ~0.90, roulette ~0.947. Blackjack must clear roulette.
    expect(returned / wagered).toBeGreaterThan(0.947);
  });
});
