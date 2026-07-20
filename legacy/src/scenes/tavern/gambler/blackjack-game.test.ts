/**
 * The blackjack TABLE — its contract with the shell, and its cue order.
 *
 * `blackjack.ts` owns the rules and `blackjack.test.ts` pins them. What is
 * pinned here is the layer that can violate the shell's invariants:
 *
 *  · `resolve()` exactly once per round. Twice would burn a second round off
 *    the per-visit limit AND pay the hand twice — see `settle()` in table.ts,
 *    which has no idea it is being lied to.
 *  · the double-down going through `raise()`, and NOT doubling when the purse
 *    can't cover it. A game that doubled anyway would be doubling for free.
 *  · the reported stake matching what was actually taken, so the shell's net
 *    and any RTP read stay honest about a double.
 *
 * The other half is the cue ORDER, which is how the hand reads. This is the
 * one game whose animation spans many frames and several phases, and every
 * failure mode there is silent: a hole card that flips before the busting card
 * has landed, a dealer that draws its whole hand between two frames, a result
 * cue that fires before the reveal. None of them throw.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCanvas } from "canvas";
import type { Card } from "./blackjack";
import type { CasinoGame } from "./index";

const cues: string[] = [];
const cue = (name: string) => (): void => {
  cues.push(name);
};
vi.mock("./blackjack-audio", () => ({
  sfxCardDeal: cue("deal"),
  sfxHoleFlip: cue("flip"),
  sfxChips: cue("chips"),
  sfxDouble: cue("double"),
  sfxDealerTick: cue("tick"),
  sfxBust: cue("bust"),
  sfxBlackjack: cue("blackjack"),
  sfxWin: cue("win"),
  sfxPush: cue("push"),
  sfxLoseHand: cue("lose"),
  sfxShuffle: cue("shuffle"),
}));

/** The stacked shoe for the hand under test, then a real deck behind it. */
let STACK: Card[] = [];
vi.mock("./blackjack", async (orig) => {
  const real = (await orig()) as typeof import("./blackjack");
  return { ...real, shuffle: () => STACK.concat(real.freshDeck()) };
});

const c = (rank: number, suit: Card["suit"] = "spades"): Card => ({ rank, suit });

interface Harness {
  game: CasinoGame;
  step(seconds: number): void;
  resolves: Array<{ stake: number; payout: number; label: string }>;
  raises: number[];
}

async function makeGame(stack: Card[], raise: (n: number) => boolean = () => true): Promise<Harness> {
  STACK = stack;
  cues.length = 0;
  const { createBlackjackGame } = await import("./blackjack-game");
  const ctx = createCanvas(520, 200).getContext("2d") as unknown as CanvasRenderingContext2D;
  const game = createBlackjackGame();
  const resolves: Harness["resolves"] = [];
  const raises: number[] = [];
  game.play(20, {
    resolve: (r) => resolves.push({ stake: r.stake, payout: r.payout, label: r.label }),
    raise: (n) => {
      raises.push(n);
      return raise(n);
    },
  });
  return {
    game,
    resolves,
    raises,
    /**
     * Advance the table.
     *
     * At 1/30 rather than 1/60: the render draws a few thousand rects a frame
     * and the node canvas is not fast, so a suite that stepped at display rate
     * spent most of its time repainting felt. Every threshold in the game is
     * an order of magnitude longer than this step, so the phase sequence is
     * identical either way.
     */
    step(seconds: number): void {
      for (let e = 0; e < seconds; e += 1 / 30) game.render(ctx, 520, 200, 1 / 30);
    },
  };
}

/**
 * Deal order is player, dealer, player, dealer — so a stacked shoe reads
 * p0, d0, p1, d1 and anything after that is drawn in turn.
 */
const shoe = (p0: Card, d0: Card, p1: Card, d1: Card, ...rest: Card[]): Card[] => [p0, d0, p1, d1, ...rest];

beforeEach(() => {
  cues.length = 0;
});

describe("the round contract", () => {
  it("resolves exactly once on a stand", async () => {
    const h = await makeGame(shoe(c(10), c(9), c(9), c(8)));
    h.step(1.2);
    h.game.onControl?.("stand");
    h.step(6);
    expect(h.resolves).toHaveLength(1);
  });

  it("resolves exactly once on a bust, and never lets the dealer draw", async () => {
    const h = await makeGame(shoe(c(10), c(6), c(9), c(9), c(13)));
    h.step(1.2);
    h.game.onControl?.("hit");
    h.step(6);
    expect(h.resolves).toHaveLength(1);
    expect(h.resolves[0].payout).toBe(0);
    // The dealer's 15 would have drawn if it had ever got the chance. A player
    // bust must lose before that happens — that asymmetry IS the house edge.
    expect(cues).not.toContain("tick");
  });

  it("resolves exactly once on a natural, with nobody acting", async () => {
    const h = await makeGame(shoe(c(1), c(9), c(13), c(8)));
    h.step(6);
    expect(h.resolves).toHaveLength(1);
    expect(h.resolves[0].payout).toBe(50); // 20g at 3:2
  });

  it("does not resolve again once the table has gone idle", async () => {
    const h = await makeGame(shoe(c(10), c(9), c(9), c(8)));
    h.step(1.2);
    h.game.onControl?.("stand");
    h.step(12);
    // Late clicks after the hand is over must not restart anything.
    h.game.onControl?.("hit");
    h.game.onControl?.("stand");
    h.step(4);
    expect(h.resolves).toHaveLength(1);
  });

  it("ignores actions once the player has busted", async () => {
    const h = await makeGame(shoe(c(10), c(6), c(9), c(9), c(13), c(2)));
    h.step(1.2);
    h.game.onControl?.("hit");
    h.game.onControl?.("hit");
    h.game.onControl?.("stand");
    h.step(6);
    expect(h.resolves).toHaveLength(1);
  });
});

describe("the double-down", () => {
  it("goes through raise() and reports the DOUBLED stake", async () => {
    const h = await makeGame(shoe(c(6), c(9), c(5), c(8), c(10)));
    h.step(1.2);
    h.game.onControl?.("double");
    h.step(6);
    // table.ts is the only thing allowed to move gold; the extra stake must
    // have been asked for, not taken.
    expect(h.raises).toEqual([20]);
    expect(h.resolves[0].stake).toBe(40);
    // 21 against the dealer's 17 — paid 2x the total wagered.
    expect(h.resolves[0].payout).toBe(80);
  });

  it("stays on the original stake when the purse can't cover it", async () => {
    const h = await makeGame(shoe(c(6), c(9), c(5), c(8), c(10)), () => false);
    h.step(1.2);
    h.game.onControl?.("double");
    expect(h.raises).toEqual([20]);
    // Refused: the hand is still live and still on one stake. Doubling anyway
    // would be doubling for free.
    expect(h.game.controls?.()).not.toHaveLength(0);
    h.game.onControl?.("stand");
    h.step(6);
    expect(h.resolves[0].stake).toBe(20);
  });

  it("can only be taken on the opening two cards", async () => {
    const h = await makeGame(shoe(c(4), c(9), c(3), c(8), c(2), c(10)));
    h.step(1.2);
    h.game.onControl?.("hit");
    h.step(0.5);
    h.game.onControl?.("double");
    expect(h.raises).toEqual([]);
    expect(h.game.controls?.().find((x) => x.id === "double")?.disabled).toBe(true);
  });

  it("takes exactly one card and then stands", async () => {
    const h = await makeGame(shoe(c(6), c(9), c(5), c(8), c(2), c(9)));
    h.step(1.2);
    h.game.onControl?.("double");
    h.step(6);
    // 13, not 22: a double draws once and stops, even on a hand that would
    // obviously want another card.
    expect(h.resolves[0].label).toContain("13");
  });
});

describe("the hand reads in order", () => {
  it("deals four cards, then hands over to the player", async () => {
    const h = await makeGame(shoe(c(10), c(9), c(9), c(8)));
    h.step(1.2);
    expect(cues.filter((x) => x === "deal")).toHaveLength(4);
    expect(cues[0]).toBe("shuffle");
    expect(cues[1]).toBe("chips");
    // Nothing has been revealed and nothing has resolved yet.
    expect(cues).not.toContain("flip");
    expect(h.game.controls?.().map((x) => x.id)).toEqual(["hit", "stand", "double"]);
  });

  it("flips the hole card BEFORE the dealer draws", async () => {
    const h = await makeGame(shoe(c(10), c(2), c(9), c(3), c(5), c(6)));
    h.step(1.2);
    h.game.onControl?.("stand");
    h.step(6);
    expect(cues.indexOf("flip")).toBeGreaterThan(-1);
    expect(cues.indexOf("flip")).toBeLessThan(cues.indexOf("tick"));
    // The dealer's 5 walked up through 10 and 16 to 21 — three draws, each
    // audible, rather than the whole hand appearing between two frames.
    expect(cues.filter((x) => x === "tick").length).toBeGreaterThanOrEqual(2);
  });

  it("lands the busting card BEFORE it turns the hole card over", async () => {
    const h = await makeGame(shoe(c(10), c(6), c(9), c(9), c(13)));
    h.step(1.2);
    const before = cues.length;
    h.game.onControl?.("hit");
    h.step(6);
    const after = cues.slice(before);
    // The fifth card's deal cue comes first; the reveal follows it. Flipping
    // on top of a card still in the air reads as two unrelated events.
    expect(after.indexOf("deal")).toBeLessThan(after.indexOf("flip"));
    expect(after).toContain("bust");
  });

  it("gives each outcome its own cue", async () => {
    const cases: Array<[string, Card[]]> = [
      ["bust", shoe(c(10), c(6), c(9), c(9), c(13))],
      ["blackjack", shoe(c(1), c(9), c(13), c(8))],
      ["push", shoe(c(10), c(10), c(9), c(9))],
      ["win", shoe(c(10), c(10), c(10), c(9))],
      ["lose", shoe(c(10), c(10), c(8), c(9))],
    ];
    for (const [expected, stack] of cases) {
      const h = await makeGame(stack);
      h.step(1.2);
      if (expected === "bust") h.game.onControl?.("hit");
      else h.game.onControl?.("stand");
      h.step(6);
      const outcomeCues = cues.filter((x) => ["bust", "blackjack", "win", "push", "lose"].includes(x));
      expect(outcomeCues, expected).toEqual([expected]);
    }
  });

  it("keeps the table busy until the hand is completely over", async () => {
    const h = await makeGame(shoe(c(10), c(2), c(9), c(3), c(5), c(6)));
    expect(h.game.busy()).toBe(true); // dealing
    h.step(1.2);
    expect(h.game.busy()).toBe(true); // player's turn
    h.game.onControl?.("stand");
    expect(h.game.busy()).toBe(true); // flipping
    h.step(6);
    // Settled and unlocked — the shell can offer another round.
    expect(h.game.busy()).toBe(false);
    expect(h.game.controls?.()).toEqual([]);
  });
});
