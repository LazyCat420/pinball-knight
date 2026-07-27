/**
 * CARD FACE — what the card SAYS about itself.
 *
 * The bug this file exists to prevent: the face used to invent skill-ish names
 * from raw stats ("Quickdraw" for any cooldown card, "Tempered Steel" for any
 * durability card) and print them as the loudest thing on the card, while the
 * monster the card came from sat in a corner at 12px. A player reasonably read
 * it as "a chip with two perks" rather than "the essence of a slain Spider".
 *
 * These assert the TEXT rules; the pixels were eyeballed against a real render.
 */
import { describe, it, expect } from "vitest";
import { CARDS, CARD_IDS } from "./cards";
import { KIND_INFO } from "./bestiary";

/** Mirrors the plaque line built in render/holo-card.ts. */
function plaqueFor(id: string): string {
  const c = CARDS[id];
  if (!c.source) return `${c.rarity.toUpperCase()} · CHASE CARD`;
  const name = c.subType ? `${KIND_INFO[c.source].label} — ${c.subType}` : KIND_INFO[c.source].label;
  return `SLAIN: ${name.toUpperCase()}`;
}

/** Mirrors the headline drawn into the art window. */
function headlineFor(id: string): string | null {
  const c = CARDS[id];
  if (!c.source) return null;
  return c.subType ? c.subType.toUpperCase() : KIND_INFO[c.source].label.toUpperCase();
}

describe("the card names its monster", () => {
  it("puts SLAIN: <monster> on every monster card", () => {
    for (const id of CARD_IDS) {
      const c = CARDS[id];
      if (!c.source) continue;
      expect(plaqueFor(id)).toMatch(/^SLAIN: /);
      expect(plaqueFor(id)).toContain(KIND_INFO[c.source].label.toUpperCase());
    }
  });

  it("names the SUB-TYPE, not just the family, on a sub-typed card", () => {
    // "SLAIN: ZOMBIE" on the Hulk card would tell the player to farm any zombie,
    // which is not what the drop table does.
    expect(plaqueFor("hulkknuckle")).toBe("SLAIN: ZOMBIE — HULK");
    expect(headlineFor("hulkknuckle")).toBe("HULK");
    expect(headlineFor("midgetclaw")).toBe("MIDGET");
    expect(headlineFor("crawlergrip")).toBe("CRAWLER");
  });

  it("uses the family name when there is no sub-type", () => {
    expect(plaqueFor("spidersilk")).toBe("SLAIN: SPIDER");
    expect(headlineFor("spidersilk")).toBe("SPIDER");
  });

  it("gives the sourceless mythics no monster to claim", () => {
    for (const id of CARD_IDS) {
      if (CARDS[id].rarity !== "mythic") continue;
      expect(headlineFor(id)).toBeNull();
      expect(plaqueFor(id)).toBe("MYTHIC · CHASE CARD");
    }
  });

  it("has a KIND_INFO label for every card's source", () => {
    // A missing label would render `undefined` on the plaque.
    for (const id of CARD_IDS) {
      const src = CARDS[id].source;
      if (src) expect(KIND_INFO[src], `no KIND_INFO for ${src}`).toBeTruthy();
    }
  });

  it("never re-introduces the invented perk names", () => {
    // These were the give-away that the card read as a skill chip. If one shows
    // up in a description again, the face has regressed.
    const banned = ["Quickdraw", "Tempered Steel", "Honed Strike", "Weighted Core"];
    for (const id of CARD_IDS) {
      for (const b of banned) {
        expect(CARDS[id].description, `${id} uses the old perk name ${b}`).not.toContain(b);
      }
    }
  });
});
