import { describe, expect, it, beforeEach } from "vitest";
import { isNotablePull, presentCardPickup } from "./card-reader";
import { CARD_IDS, CARDS } from "./cards";
import { state } from "./state";

describe("notable pulls", () => {
  // `isNotablePull` used to decide whether a pickup PAUSED the game. Nothing
  // pauses any more (see the header of card-reader.ts) — it now only decides
  // what gets flagged on the end-of-floor haul screen. The shape of the policy
  // is still worth pinning: a card new to this run, or epic and above.

  it("flags the first copy of any card", () => {
    for (const id of CARD_IDS) {
      expect(isNotablePull(id, new Set())).toBe(true);
    }
  });

  it("does not flag repeat commons and rares", () => {
    const seen = new Set(CARD_IDS);
    for (const id of CARD_IDS) {
      const r = CARDS[id].rarity;
      if (r === "common" || r === "rare") {
        expect(isNotablePull(id, seen)).toBe(false);
      }
    }
  });

  it("always flags epic and above, even repeats", () => {
    const seen = new Set(CARD_IDS);
    for (const id of CARD_IDS) {
      const r = CARDS[id].rarity;
      if (r === "epic" || r === "legendary" || r === "mythic") {
        expect(isNotablePull(id, seen)).toBe(true);
      }
    }
  });
});

describe("a card pickup never interrupts the fight", () => {
  beforeEach(() => {
    state.floorHaul = [];
    state.seenCards = new Set();
    state.cardReaderEl = null;
  });

  // THE regression this whole change exists to prevent. Picking up a card at
  // 22 u/s used to open a modal that froze the sim until the player pressed
  // Space. Whatever else presentCardPickup does, it must not set the pause
  // handle — `core.isSimPaused` reads exactly this field.
  it("opens nothing that pauses the sim", () => {
    presentCardPickup(CARD_IDS[0], "STASHED");
    expect(state.cardReaderEl).toBeNull();
  });

  it("files each pickup into the floor haul, in order, with its note", () => {
    presentCardPickup(CARD_IDS[0], "SOCKETED");
    presentCardPickup(CARD_IDS[1], "STASHED");
    expect(state.floorHaul.map((e) => e.id)).toEqual([CARD_IDS[0], CARD_IDS[1]]);
    expect(state.floorHaul[0].note).toBe("SOCKETED");
  });

  it("marks only the first copy of a card fresh", () => {
    presentCardPickup(CARD_IDS[0], "a");
    presentCardPickup(CARD_IDS[0], "b");
    expect(state.floorHaul.map((e) => e.fresh)).toEqual([true, false]);
  });
});
