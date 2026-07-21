import { describe, expect, it } from "vitest";
import { shouldOpenReader } from "./card-reader";
import { CARD_IDS, CARDS } from "./cards";

describe("card reader policy", () => {
  // The contract: the modal reader interrupts (and PAUSES the game) only when
  // the interruption earns its cost — a card you haven't seen this run, or a
  // pull big enough to savor. Everything else keeps the non-blocking popup.

  it("opens for the first copy of any card", () => {
    for (const id of CARD_IDS) {
      expect(shouldOpenReader(id, new Set())).toBe(true);
    }
  });

  it("falls back to the popup for repeat commons and rares", () => {
    const seen = new Set(CARD_IDS);
    for (const id of CARD_IDS) {
      const r = CARDS[id].rarity;
      if (r === "common" || r === "rare") {
        expect(shouldOpenReader(id, seen)).toBe(false);
      }
    }
  });

  it("always opens for epic and above, even repeats", () => {
    const seen = new Set(CARD_IDS);
    for (const id of CARD_IDS) {
      const r = CARDS[id].rarity;
      if (r === "epic" || r === "legendary" || r === "mythic") {
        expect(shouldOpenReader(id, seen)).toBe(true);
      }
    }
  });
});
