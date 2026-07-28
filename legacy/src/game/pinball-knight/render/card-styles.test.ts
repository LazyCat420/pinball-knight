/**
 * CARD STYLES — the material families, and the per-card tint inside them.
 *
 * The bug this file exists to prevent: "the cards are just solid colours".
 * Six materials is six palettes, and a dealer counter shows three cards while a
 * stash shows thirty — so whenever two of them shared a family they rendered as
 * literally the same swatch and a row of cards read as one repeated tile. The
 * material was doing its job ("this is a bone card") and then stopping.
 *
 * `styleForCard` fixes that by tinting the family per card. These assert the
 * two properties that make the tint worth having: it must be STABLE (a card is
 * the same colour every time it is drawn, forever) and it must be VISIBLE
 * (two cards of one family must actually differ). The first cut satisfied
 * stability and failed visibility — ±20° of hue on a near-black stock is very
 * nearly nothing, because there is no saturation there to rotate.
 */
import { describe, it, expect } from "vitest";
import { KIND_STYLE, STYLES, styleFor, styleForCard, elementFor } from "./card-styles";
import { CARDS, CARD_IDS } from "../cards";

/** Perceptual-ish distance between two #rrggbb colours, 0..~441. */
function dist(a: string, b: string): number {
  const rgb = (h: string): number[] => {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

describe("every monster has a printed material", () => {
  it("assigns a style to every card, sourced or not", () => {
    for (const id of CARD_IDS) {
      const st = styleForCard(CARDS[id].source, id);
      expect(st.imprint, `${id} has no imprint`).toBeTruthy();
      expect(st.stock[0]).toMatch(/^#[0-9a-f]{6}$/);
      expect(st.stock[1]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("sends sourceless chase cards to the void stock", () => {
    expect(styleFor(undefined).imprint).toBe(STYLES.void.imprint);
  });

  it("keeps KIND_STYLE pointing at real styles", () => {
    for (const [kind, sid] of Object.entries(KIND_STYLE)) {
      expect(STYLES[sid], `${kind} → ${sid} is not a style`).toBeTruthy();
    }
  });

  it("keeps the six materials distinguishable FROM EACH OTHER", () => {
    // Slate and iron were authored 1.4/255 apart — both are "dark grey", so
    // writing them from intuition produced two families that rendered as one
    // colour, and a Golem card was indistinguishable from a Goblin card. Six
    // materials are only worth having if all six can be told apart, and no
    // amount of per-card tinting fixes two families that start out identical.
    const ids = Object.keys(STYLES) as (keyof typeof STYLES)[];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const d = dist(STYLES[ids[i]].stock[1], STYLES[ids[j]].stock[1]);
        expect(d, `${ids[i]} and ${ids[j]} are the same stock (Δ${d.toFixed(1)})`).toBeGreaterThan(10);
      }
    }
  });
});

describe("the per-card tint", () => {
  it("is STABLE — a card is the same colour every time it is painted", () => {
    // The tint comes from the card's fixed SLOT among its family, so a Hobbler
    // Brace is the same colour on every screen and in every session. A card
    // whose colour drifted between repaints would be worse than a flat palette.
    for (const id of CARD_IDS.slice(0, 8)) {
      const a = styleForCard(CARDS[id].source, id);
      const b = styleForCard(CARDS[id].source, id);
      expect(a.stock).toEqual(b.stock);
      expect(a.accent).toBe(b.accent);
      expect(a.glow).toBe(b.glow);
    }
  });

  it("is VISIBLE — two cards of the SAME family never share a colour", () => {
    // This is the whole point. Group the catalogue by material and assert that
    // within a family every card's stock is measurably distinct.
    const byFamily = new Map<string, string[]>();
    for (const id of CARD_IDS) {
      const fam = styleFor(CARDS[id].source).imprint;
      byFamily.set(fam, [...(byFamily.get(fam) ?? []), id]);
    }
    // The bone family is the big one (zombies + brute + reaper …) and is where
    // the duplicate-swatch problem was actually seen on the live dealer.
    const bone = byFamily.get(STYLES.bone.imprint) ?? [];
    expect(bone.length).toBeGreaterThan(3);

    for (const [fam, ids] of byFamily) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = styleForCard(CARDS[ids[i]].source, ids[i]);
          const b = styleForCard(CARDS[ids[j]].source, ids[j]);
          const d = dist(a.stock[1], b.stock[1]);
          expect(d, `${fam}: ${ids[i]} and ${ids[j]} render the same stock (Δ${d.toFixed(1)})`).toBeGreaterThan(3);
        }
      }
    }
  });

  it("stays INSIDE its family — the tint varies a card, it does not reclassify it", () => {
    // The counterweight to the test above: if the shift were unbounded, a bone
    // card could drift far enough to read as chitin and the material system
    // would stop meaning anything.
    //
    // The bound is deliberately generous (the tint's whole job is to be VISIBLE,
    // and the lightest card of a family is a long way from the family's base by
    // design) but it is still a bound: a tinted stock must stay nearer its own
    // family than that family's base is to any OTHER family's base. That is the
    // property that actually matters — "still recognisably bone" — rather than
    // an arbitrary distance.
    // The property is asserted in HUE, not in raw RGB distance.
    //
    // Raw distance is the wrong measure here and asserting it sent me chasing a
    // fix that does not exist. These stocks all live at lightness 0.12-0.17,
    // and the dark corner of RGB space is small: six deliberately hue-separated
    // stocks still land only ~15/255 apart at that darkness, while a per-card
    // lightness spread wide enough to SEE moves a card ~20/255. So "nearer its
    // own family's base in RGB" is unsatisfiable for any visible spread — not
    // because the tint is wrong, but because the metric is.
    //
    // What actually carries "this is a bone card" to the eye is HUE, which
    // survives darkness. Lightness is free to spread as far as it needs to.
    const hueOf = (h: string): number => {
      const n = parseInt(h.slice(1), 16);
      const [r, g, b] = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max === min) return 0;
      const d = max - min;
      const t = max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6 : max === g ? ((b - r) / d + 2) / 6 : ((r - g) / d + 4) / 6;
      return t * 360;
    };
    for (const id of CARD_IDS) {
      const base = styleFor(CARDS[id].source);
      const tinted = styleForCard(CARDS[id].source, id);
      const delta = Math.abs(((hueOf(tinted.stock[1]) - hueOf(base.stock[1]) + 540) % 360) - 180);
      // A wider rotation was tried and rendered beautifully varied cards that no
      // longer read as a SET: at ±34° the bone family ran crimson → magenta →
      // olive, so Brute Cleaver and Shambler Hide shared an imprint and nothing
      // else. 25° keeps the family one colour.
      expect(delta, `${id} rotated ${delta.toFixed(0)}° off its family's hue`).toBeLessThan(25);
    }
  });
});

describe("the element mark", () => {
  it("returns a drawable path for every card in the catalogue", () => {
    // Never an emoji, and never undefined — the mark is painted unconditionally.
    for (const id of CARD_IDS) {
      expect(elementFor(CARDS[id].modifier)).toBeTypeOf("function");
    }
  });
});
