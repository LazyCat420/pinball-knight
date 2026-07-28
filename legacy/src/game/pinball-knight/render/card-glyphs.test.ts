/**
 * CARD GLYPHS — the no-emoji guarantee, and the geometry that reads wrong.
 *
 * Two classes of bug live here:
 *
 *  1. AN EMOJI COMES BACK. The whole reason this library exists is that the
 *     card face painted `⚔️ ⚡ 🔥 ❄️ 🛡️` with `ctx.fillText`, which is
 *     font-dependent: a headless render of the old face drew a ✗-in-a-circle
 *     where the energy emblem belonged on nearly every card. A test can't see
 *     pixels, but it CAN assert that the card face's source contains no emoji
 *     text draws — see card-face.test.ts for that half.
 *
 *  2. A GLYPH DRAWS ITSELF INSIDE OUT. The rib-cage sigil went through three
 *     parameterisations that each looked reasonable in source and rendered as
 *     croquet hoops, because every rib crested ABOVE the spine anchor it grew
 *     from. That is a property of the curve, not of the pixels, so it is
 *     testable: record the points and assert the shape's invariants.
 *
 * Glyphs are recorded through a fake CanvasRenderingContext2D — no DOM.
 */
import { describe, it, expect } from "vitest";
import * as G from "./card-glyphs";
import { CARDS, CARD_IDS } from "../cards";

interface Pt {
  x: number;
  y: number;
}

/**
 * A recording 2D context: enough surface for the glyph library, capturing every
 * point in the glyph's own unit space (drawGlyph's translate/scale is applied
 * by the caller, so recording raw is what we want).
 */
function recorder(): { ctx: CanvasRenderingContext2D; pts: Pt[]; calls: string[] } {
  const pts: Pt[] = [];
  const calls: string[] = [];
  const put = (x: number, y: number): void => {
    pts.push({ x, y });
  };
  const ctx = {
    lineWidth: 1,
    lineJoin: "round",
    lineCap: "round",
    fillStyle: "#000",
    strokeStyle: "#000",
    save() {
      calls.push("save");
    },
    restore() {
      calls.push("restore");
    },
    translate() {},
    scale() {},
    rotate() {},
    beginPath() {
      calls.push("beginPath");
    },
    closePath() {},
    moveTo: put,
    lineTo: put,
    quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
      put(cx, cy);
      put(x, y);
    },
    bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number) {
      put(a, b);
      put(c, d);
      put(x, y);
    },
    arc(x: number, y: number, r: number) {
      put(x - r, y - r);
      put(x + r, y + r);
    },
    ellipse(x: number, y: number, rx: number, ry: number) {
      put(x - rx, y - ry);
      put(x + rx, y + ry);
    },
    rect: (x: number, y: number, w: number, h: number) => {
      put(x, y);
      put(x + w, y + h);
    },
    fillRect(x: number, y: number, w: number, h: number) {
      put(x, y);
      put(x + w, y + h);
    },
    fill() {
      calls.push("fill");
    },
    stroke() {
      calls.push("stroke");
    },
    fillText() {
      calls.push("fillText");
    },
    measureText: () => ({ width: 0 }),
  } as unknown as CanvasRenderingContext2D;
  return { ctx, pts, calls };
}

const EMBLEMS = [
  "glyphBolt",
  "glyphFlame",
  "glyphFrost",
  "glyphShield",
  "glyphBlades",
  "glyphMomentum",
  "glyphSwift",
  "glyphFang",
  "glyphSparkle",
  "glyphPip",
] as const;

const SIGILS = ["sigilWorldBreaker", "sigilTimeRipper", "sigilTempestCrown", "sigilGlassCannon", "sigilBloodPact", "sigilSeal"] as const;

describe("every glyph is geometry, never text", () => {
  it("draws no text at all — that is the entire point of the library", () => {
    for (const name of [...EMBLEMS, ...SIGILS]) {
      const { ctx, calls } = recorder();
      (G as never as Record<string, G.Glyph>)[name](ctx);
      expect(calls, `${name} called fillText — an emoji or label crept back in`).not.toContain("fillText");
    }
  });

  it("actually marks the canvas", () => {
    for (const name of [...EMBLEMS, ...SIGILS]) {
      const { ctx, calls, pts } = recorder();
      (G as never as Record<string, G.Glyph>)[name](ctx);
      expect(calls.some((c) => c === "fill" || c === "stroke"), `${name} drew nothing`).toBe(true);
      expect(pts.length, `${name} emitted no points`).toBeGreaterThan(2);
    }
  });

  it("stays inside its unit box, so a caller can size it by radius alone", () => {
    // drawGlyph scales by `r`, so a glyph that wandered to ±3 would silently
    // overflow whatever box the card face reserved for it.
    for (const name of [...EMBLEMS, ...SIGILS]) {
      const { ctx, pts } = recorder();
      (G as never as Record<string, G.Glyph>)[name](ctx);
      const max = Math.max(...pts.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))));
      expect(max, `${name} extends to ${max.toFixed(2)} — well past its unit box`).toBeLessThanOrEqual(1.6);
    }
  });
});

describe("the rib-cage sigil hangs the right way up", () => {
  // This is the regression that three rewrites failed to fix by eye. The ribs
  // are anchored on the sternum at x=0 and must fall AWAY from it; when the
  // curve crested above its own anchor the cage rendered as croquet hoops.
  it("never crosses the sternum — no point sits on the far side of x=0 from its own arc", () => {
    const { ctx, pts } = recorder();
    G.sigilGlassCannon(ctx);
    // Points exist on both sides (it is a two-sided cage), but the SPAN either
    // way must stay inside the authored half-width; a rib that overshot the
    // spine used to produce points far past it.
    const xs = pts.map((p) => p.x);
    expect(Math.max(...xs)).toBeLessThanOrEqual(1.1);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-1.1);
  });

  it("draws a broken right side — the card's durability drawback, said in the art", () => {
    const { ctx, pts } = recorder();
    G.sigilGlassCannon(ctx);
    // The intact left ribs reach further out than the snapped right ones do at
    // the same rows, so the cage is visibly asymmetric.
    const leftReach = Math.abs(Math.min(...pts.map((p) => p.x)));
    const rightRibs = pts.filter((p) => p.x > 0 && p.y > -0.4 && p.y < 0.3);
    const rightReach = Math.max(...rightRibs.map((p) => p.x));
    expect(rightReach).toBeLessThan(leftReach);
  });
});

describe("mythic sigils", () => {
  it("gives every sourceless chase card its own authored mark", () => {
    // The mythics used to fall back to a 150px emoji — the rarest cards in the
    // game were the only ones with no real art. Each one is hand-drawn now.
    //
    // Derived from the CATALOGUE rather than from a hand-written id list, so
    // adding a sixth sourceless card FAILS here instead of silently shipping
    // the generic seal. `CARD_SIGILS` is keyed by a plain string and cannot
    // enforce this in the type system; this test is the enforcement.
    const sourceless = CARD_IDS.filter((id) => !CARDS[id].source);
    expect(sourceless.length).toBeGreaterThan(0);
    for (const id of sourceless) {
      expect(G.CARD_SIGILS[id], `${id} is sourceless but has no authored sigil`).toBeTypeOf("function");
    }
  });

  it("gives every sourceless chase card its own type line and flavour", () => {
    // Same rule for the COPY: without these a mythic prints a shared
    // "UNBOUND RELIC" and no flavour, which is how the five rarest cards in the
    // game ended up the least written.
    for (const id of CARD_IDS.filter((cid) => !CARDS[cid].source)) {
      expect(CARDS[id].typeLine, `${id} has no typeLine`).toBeTruthy();
      expect(CARDS[id].flavour, `${id} has no flavour`).toBeTruthy();
    }
  });

  it("falls back to a seal rather than to nothing", () => {
    expect(G.sigilFor("a-card-that-does-not-exist")).toBe(G.sigilSeal);
    expect(G.sigilFor("worldbreaker")).toBe(G.sigilWorldBreaker);
  });
});
