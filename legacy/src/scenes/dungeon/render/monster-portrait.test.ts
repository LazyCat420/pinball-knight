/**
 * MONSTER PORTRAIT tests.
 *
 * The property that matters is COVERAGE and HONESTY: every monster a card can
 * be sourced to must actually paint, and the portrait must be the same art the
 * player fights. A card claiming "SLAIN: WISP" over a blank window is the exact
 * failure this module was written to end.
 *
 * These run in a DOM-free vitest environment, so `document` is shimmed with
 * node-canvas — the same trick the render harness uses. That also pins the
 * headless-safety guard: without the shim the module must return null rather
 * than throw, because holo-card.ts is imported by card-face.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createCanvas } from "canvas";
import { CARDS, CARD_IDS } from "../cards";
import { KIND_IDS } from "../bestiary";
import { ZOMBIE_TYPE_IDS } from "../zombie-types";

const realDoc = (globalThis as { document?: unknown }).document;

beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: (t: string) => (t === "canvas" ? createCanvas(1, 1) : {}),
  };
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = realDoc;
});

/** How many pixels the portrait actually painted, and how many are opaque. */
function coverage(cv: HTMLCanvasElement): { painted: number; total: number } {
  const ctx = cv.getContext("2d")!;
  const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
  let painted = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 8) painted++;
  return { painted, total: data.length / 4 };
}

describe("monsterPortrait", () => {
  it("paints a portrait for EVERY monster kind", async () => {
    const { monsterPortrait } = await import("./monster-portrait");
    for (const kind of KIND_IDS) {
      const cv = monsterPortrait(kind);
      expect(cv, `no portrait for ${kind}`).not.toBeNull();
      const { painted } = coverage(cv!);
      expect(painted, `${kind} painted nothing`).toBeGreaterThan(200);
    }
  });

  it("paints a portrait for every zombie SUB-TYPE", async () => {
    const { monsterPortrait } = await import("./monster-portrait");
    for (const sub of ZOMBIE_TYPE_IDS) {
      const cv = monsterPortrait("zombie", sub);
      expect(cv, `no portrait for zombie:${sub}`).not.toBeNull();
      expect(coverage(cv!).painted).toBeGreaterThan(200);
    }
  });

  it("every source-bearing CARD resolves to a real portrait", async () => {
    const { monsterPortrait } = await import("./monster-portrait");
    for (const id of CARD_IDS) {
      const c = CARDS[id];
      if (!c.source) continue;
      expect(monsterPortrait(c.source, c.subType), `card ${id}`).not.toBeNull();
    }
  });

  it("a TINTED kind stays a silhouette — never a filled rectangle", async () => {
    // The regression this pins: tinting in-place filled the transparent
    // background too, and the Wisp card rendered as a solid cyan BLOCK sitting
    // in the art window. A portrait must never cover its whole box.
    const { monsterPortrait, _clearPortraitCache } = await import("./monster-portrait");
    _clearPortraitCache();
    for (const kind of ["wisp", "necromancer", "hound", "mimic"] as const) {
      const cv = monsterPortrait(kind)!;
      const { painted, total } = coverage(cv);
      expect(painted / total, `${kind} filled its whole box`).toBeLessThan(0.9);
      expect(painted, `${kind} painted nothing`).toBeGreaterThan(200);
    }
  });

  it("memoises — the same kind returns the identical canvas", async () => {
    const { monsterPortrait, _clearPortraitCache } = await import("./monster-portrait");
    _clearPortraitCache();
    expect(monsterPortrait("spider")).toBe(monsterPortrait("spider"));
  });

  it("zombie sub-types do not all wear the same silhouette", async () => {
    // Five sub-types are variant-unfiltered; before the spread they all took
    // ZOMBIE_VARIANTS[0], so Hulk and Midget were one body at two zoom levels.
    const { monsterPortrait, _clearPortraitCache } = await import("./monster-portrait");
    _clearPortraitCache();
    const sigs = new Set(
      ZOMBIE_TYPE_IDS.map((s) => {
        const cv = monsterPortrait("zombie", s)!;
        return cv.toDataURL();
      }),
    );
    expect(sigs.size, "all zombie sub-types painted the same portrait").toBeGreaterThan(3);
  });
});

describe("portraitScale", () => {
  it("a HULK portrait is drawn larger than a MIDGET one", async () => {
    const { portraitScale } = await import("./monster-portrait");
    expect(portraitScale("zombie", "hulk")).toBeGreaterThan(portraitScale("zombie", "midget"));
  });

  it("is finite and positive for every kind", async () => {
    const { portraitScale } = await import("./monster-portrait");
    for (const kind of KIND_IDS) {
      const s = portraitScale(kind);
      expect(Number.isFinite(s) && s > 0, `bad scale for ${kind}`).toBe(true);
    }
  });
});

describe("headless safety", () => {
  it("returns null instead of throwing when there is no document", async () => {
    const { monsterPortrait, _clearPortraitCache } = await import("./monster-portrait");
    const saved = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = undefined;
    _clearPortraitCache();
    expect(() => monsterPortrait("spider")).not.toThrow();
    expect(monsterPortrait("spider")).toBeNull();
    (globalThis as { document?: unknown }).document = saved;
    _clearPortraitCache();
  });
});
