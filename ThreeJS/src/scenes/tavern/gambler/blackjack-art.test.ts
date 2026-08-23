/**
 * The pure bits of the blackjack table's art.
 *
 * Three things worth pinning, all of which fail SILENTLY — they produce a
 * picture, just the wrong one, and nobody notices for weeks:
 *
 *  · the chip breakdown, which is the player's bet rendered as colours. A wrong
 *    breakdown is a lie about how much gold is on the table.
 *  · the pip layouts, where the count printed on a card must equal its rank. A
 *    nine that prints eight pips looks completely fine until you count it.
 *  · the circle rasteriser, whose sorted-and-deduped output is what makes the
 *    betting spot's stitching regular instead of speckled.
 */
import { describe, it, expect } from "vitest";
import { chipStack, chipInk, circleOutline, CHIP_INKS, MAX_STACK } from "./blackjack-art";
import { pipLayout, paintedSuits, paintedRanks } from "./cards-art";
import { freshDeck, rankLabel } from "./blackjack";
import { stakeOptions } from "./table";

describe("chip breakdown", () => {
  it("mints a single chip for each denomination", () => {
    for (const ink of CHIP_INKS) expect(chipStack(ink.value)).toEqual([ink.value]);
  });

  it("breaks a bet into the largest chips first", () => {
    expect(chipStack(50)).toEqual([25, 25]);
    expect(chipStack(137)).toEqual([100, 25, 10, 1, 1]);
    expect(chipStack(4)).toEqual([1, 1, 1, 1]);
  });

  it("always sums back to the bet when it fits in the stack", () => {
    for (let amount = 0; amount <= 200; amount++) {
      const stack = chipStack(amount);
      if (stack.length >= MAX_STACK) continue;
      expect(stack.reduce((a, b) => a + b, 0), `${amount}g`).toBe(amount);
    }
  });

  it("covers every stake the table offers, and its double", () => {
    // Doubling is the only way the wagered amount leaves the stake ladder, and
    // a 200g stack that silently drops chips would misdraw the biggest bet in
    // the game.
    for (const stake of stakeOptions(1000)) {
      for (const amount of [stake, stake * 2]) {
        expect(chipStack(amount).length, `${amount}g`).toBeLessThanOrEqual(MAX_STACK);
        expect(chipStack(amount).reduce((a, b) => a + b, 0), `${amount}g`).toBe(amount);
      }
    }
  });

  it("drops the SMALLEST chips when a bet won't fit in the stack", () => {
    // Losing the 1g chips off a huge bet misrepresents it far less than losing
    // the 100s, so the cap must bite at the small end.
    const stack = chipStack(999);
    expect(stack).toHaveLength(MAX_STACK);
    expect(stack[0]).toBe(100);
    expect(stack).toEqual([...stack].sort((a, b) => b - a));
  });

  it("draws nothing for no bet", () => {
    expect(chipStack(0)).toEqual([]);
    expect(chipStack(-5)).toEqual([]);
  });

  it("has ink for every denomination it can emit", () => {
    for (const v of chipStack(137)) expect(chipInk(v).value).toBe(v);
  });
});

describe("pip layouts", () => {
  it("prints exactly as many pips as the rank", () => {
    for (let rank = 2; rank <= 10; rank++) {
      expect(pipLayout(rank), `rank ${rank}`).toHaveLength(rank);
    }
  });

  it("has no layout for ranks that are drawn some other way", () => {
    // The ace gets one oversized pip and the courts get a figure — a pip field
    // for those would print on TOP of the art rather than instead of it.
    for (const rank of [1, 11, 12, 13]) expect(pipLayout(rank)).toEqual([]);
  });

  it("keeps every pip inside the card", () => {
    for (let rank = 2; rank <= 10; rank++) {
      for (const [cx, cy] of pipLayout(rank)) {
        expect(cx).toBeGreaterThanOrEqual(0);
        expect(cx).toBeLessThanOrEqual(1);
        expect(cy).toBeGreaterThanOrEqual(0);
        expect(cy).toBeLessThanOrEqual(1);
      }
    }
  });

  it("never prints two pips in the same place", () => {
    for (let rank = 2; rank <= 10; rank++) {
      const keys = pipLayout(rank).map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`);
      expect(new Set(keys).size, `rank ${rank}`).toBe(keys.length);
    }
  });
});

describe("card art coverage", () => {
  it("every card in the deck has a pip and an index glyph", () => {
    // Both are looked up at DRAW time, mid-hand, with the bet already down.
    const suits = new Set(paintedSuits());
    const ranks = new Set(paintedRanks());
    for (const card of freshDeck()) {
      expect(suits.has(card.suit), `"${card.suit}" has no pip`).toBe(true);
      expect(ranks.has(rankLabel(card.rank)), `"${rankLabel(card.rank)}" has no glyph`).toBe(true);
    }
  });
});

describe("the betting circle rasteriser", () => {
  it("emits each point exactly once", () => {
    // The eight-way symmetry emits the diagonals twice. A doubled point shows
    // up as a visible hiccup in the stitching dash pattern.
    for (const r of [4, 9, 17, 30]) {
      const pts = circleOutline(r);
      const keys = pts.map(([x, y]) => `${x},${y}`);
      expect(new Set(keys).size, `r=${r}`).toBe(keys.length);
    }
  });

  it("puts every point on the circle", () => {
    for (const r of [4, 9, 17, 30]) {
      for (const [x, y] of circleOutline(r)) {
        const d = Math.hypot(x, y);
        expect(Math.abs(d - r), `r=${r} at ${x},${y}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("returns points ordered around the perimeter", () => {
    // Sorted order is what makes dashing produce STITCHES. Dashing an unsorted
    // point set produces random speckle, which is what it did first.
    const angles = circleOutline(17).map(([x, y]) => Math.atan2(y, x));
    for (let i = 1; i < angles.length; i++) expect(angles[i]).toBeGreaterThanOrEqual(angles[i - 1]);
  });

  it("draws a closed ring — no gaps a stitch could fall through", () => {
    // Consecutive points must be adjacent, or the ring has a hole in it.
    const pts = circleOutline(17);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      expect(Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])), `${a} -> ${b}`).toBeLessThanOrEqual(2);
    }
  });
});
