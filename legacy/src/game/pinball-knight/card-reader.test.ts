import { describe, expect, it, beforeEach } from "vitest";
import { isNotablePull, presentCardPickup, stackHaul } from "./card-reader";
import { CARD_IDS, CARDS, cardKey } from "./cards";
import { state, type HaulEntry } from "./state";

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
    state.uiPauses = false;
  });

  // THE regression this whole change exists to prevent. Picking up a card at
  // 22 u/s used to open a modal that froze the sim until the player pressed
  // Space. Whatever else presentCardPickup does, it must not raise anything
  // that pauses — `core.isSimPaused` reads exactly this flag.
  //
  // The handle changed name (`cardReaderEl` → `uiPauses`) when modality stopped
  // being stored as a DOM node, but the invariant is identical and so is the
  // failure it guards.
  it("opens nothing that pauses the sim", () => {
    presentCardPickup(CARD_IDS[0], "STASHED");
    expect(state.uiPauses).toBe(false);
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

  it("tracks seen-ness by card KIND, so a new LEVEL is not a discovery", () => {
    // Keying `seenCards` on the full instance id would flag every levelled copy
    // of a card you already own as NEW, and the badge would stop meaning
    // anything within two floors.
    presentCardPickup("spidersilk", "a");
    presentCardPickup("spidersilk#6", "b");
    expect(state.floorHaul.map((e) => e.fresh)).toEqual([true, false]);
  });
});

/**
 * THE STACKED HAUL — the screen at the end of a floor.
 *
 * Before this, twelve pickups meant twelve cells, eight of which were the same
 * face repeated, squeezed to 92px each so none of them was readable. Duplicates
 * now collapse to one cell carrying a ×N count.
 */
describe("stackHaul", () => {
  const e = (id: string, note = "STASHED", fresh = false): HaulEntry => ({ id, note, fresh });

  it("collapses identical copies into one row with a count", () => {
    const out = stackHaul([e("spidersilk"), e("spidersilk"), e("spidersilk")]);
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(3);
    expect(out[0].id).toBe("spidersilk");
  });

  it("keeps DIFFERENT levels of the same card apart", () => {
    // A level-3 Spider Silk and a level-1 Spider Silk have different stats.
    // Merging them would misreport what the floor actually handed you.
    const out = stackHaul([e("spidersilk"), e(cardKey("spidersilk", 3)), e(cardKey("spidersilk", 3))]);
    expect(out).toHaveLength(2);
    expect(out.find((s) => s.id === "spidersilk#3")!.count).toBe(2);
    expect(out.find((s) => s.id === "spidersilk")!.count).toBe(1);
  });

  it("keeps a SHINY apart from the plain copy at the same level", () => {
    const out = stackHaul([e(cardKey("spidersilk", 3)), e(cardKey("spidersilk", 3, true))]);
    expect(out).toHaveLength(2);
  });

  it("leads with the best pull, not the first one picked up", () => {
    // The thing worth looking at must not sit at position nine behind eight
    // commons — that ordering is what made the screen read as noise.
    const out = stackHaul([
      e("spidersilk"), // common
      e("worldbreaker"), // mythic
      e("goblintooth"), // rare
      e("crawlergrip"), // epic
    ]);
    expect(out.map((s) => s.id)).toEqual(["worldbreaker", "crawlergrip", "goblintooth", "spidersilk"]);
  });

  it("puts a shiny ahead of a plain card of the same rarity, and a higher level ahead of a lower", () => {
    const out = stackHaul([e("spidersilk"), e(cardKey("spidersilk", 9)), e(cardKey("batwingchip", 2, true))]);
    expect(out.map((s) => s.id)).toEqual(["batwingchip#2s", "spidersilk#9", "spidersilk"]);
  });

  it("ORs freshness across the stack", () => {
    // The first copy was the discovery; the stack it ends up in still earns the
    // NEW badge even though the later copies weren't fresh.
    expect(stackHaul([e("spidersilk", "a", true), e("spidersilk", "b", false)])[0].fresh).toBe(true);
    expect(stackHaul([e("spidersilk", "a", false), e("spidersilk", "b", false)])[0].fresh).toBe(false);
  });

  it("de-duplicates the destination notes", () => {
    const out = stackHaul([e("spidersilk", "STASHED"), e("spidersilk", "STASHED"), e("spidersilk", "SOCKETED")]);
    expect(out[0].notes).toEqual(["STASHED", "SOCKETED"]);
  });

  it("drops entries whose base card isn't in the catalogue", () => {
    // A wire value from an older peer, or a stale save. The haul must render
    // what it can rather than throwing on the way to the tavern.
    expect(stackHaul([e("nosuchcard"), e("nosuchcard#4s"), e("spidersilk")])).toHaveLength(1);
  });

  it("is empty for an empty haul", () => {
    expect(stackHaul([])).toEqual([]);
  });

  it("preserves the total card count across the fold", () => {
    const entries = [...CARD_IDS, ...CARD_IDS, cardKey(CARD_IDS[0], 5, true)].map((id) => e(id));
    const out = stackHaul(entries);
    expect(out.reduce((n, s) => n + s.count, 0)).toBe(entries.length);
  });
});
