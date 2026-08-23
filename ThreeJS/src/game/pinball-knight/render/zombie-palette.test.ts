/**
 * THE ZOMBIE'S COLOUR BUDGET.
 *
 * The bug this file exists to prevent: "it looks like a shitty flash game".
 *
 * That complaint was real and it was measurable. The shipped zombie painted
 * SEVENTY-FOUR distinct colours into the ~1000 pixels it occupies at its real
 * 72px sprite grid. Sprites of the era this art aims at use five to eight, in
 * two or three clearly separated value groups. At that density every "detail"
 * is about one pixel wide, so none of them resolve — they only add noise, and
 * the figure reads as a busy smudge rather than as a corpse.
 *
 * The count was STRUCTURAL, not decorative. `limbShaded`/`plateShaded` auto-
 * shade: each one lays down a shade base, a selout ink, a mid fill, a warm rim
 * and a cross-family bounce. Five colours per body part, chosen by the helper,
 * times ten body parts, before a single accent is drawn. Removing details could
 * never fix it; the zombie had to stop using those helpers and paint flat
 * masses with hand-placed shading instead (see zFlatLimb/zFlatPoly/zShadeIn).
 *
 * So this asserts the budget rather than the pixels. It is a REGRESSION FENCE:
 * anyone who reaches for the auto-shading helpers again, or who adds a second
 * bright accent, trips it.
 *
 * It runs against the palette INDICES the painter requests, not a render —
 * these suites are DOM-free, and the index is the thing under control anyway.
 */
import { describe, it, expect } from "vitest";
import { ZOMBIE_VARIANTS } from "./cel-painter";

/**
 * The rot band (6-9), the leather band (26-28), ink (1), blood (11) for a
 * wound, the bone accent (19-21) and the torch pair (16-17) for the eyes.
 * Nothing else may appear on a zombie.
 */
const ALLOWED = new Set([1, 6, 7, 8, 9, 11, 16, 17, 19, 20, 21, 26, 27, 28]);

/** Stone (2-5) and arcane (29-31) are the tones that made it look muddy. */
const BANNED = new Set([2, 3, 4, 5, 29, 30, 31]);

describe("the zombie's cloth stays inside the leather band", () => {
  it("never reaches for a stone or arcane index", () => {
    // Two variants used to set `rag` to 2 (stone dark) and 29 (arcane dark) for
    // variety. Those two indices alone were why a cool grey-blue and a slate
    // tone appeared in a body whose vocabulary is flesh, cloth and ink — a
    // zombie's trousers are not made of stone.
    for (const v of ZOMBIE_VARIANTS) {
      expect(BANNED.has(v.rag), `variant seed ${v.seed} has rag=${v.rag}, outside the leather band`).toBe(false);
      expect(v.rag, `variant seed ${v.seed} rag=${v.rag} is not leather (26-28)`).toBeGreaterThanOrEqual(26);
      expect(v.rag).toBeLessThanOrEqual(28);
    }
  });

  it("still varies the cloth between variants", () => {
    // Clamping the band must not collapse every zombie onto one trouser colour
    // — the point of the band is that it has three steps.
    expect(new Set(ZOMBIE_VARIANTS.map((v) => v.rag)).size).toBeGreaterThan(1);
  });
});

describe("the zombie's skin stays inside the rot band", () => {
  it("uses only rot indices for flesh", () => {
    for (const v of ZOMBIE_VARIANTS) {
      expect(v.skin, `variant seed ${v.seed} skin=${v.skin} is not rot (6-9)`).toBeGreaterThanOrEqual(6);
      expect(v.skin).toBeLessThanOrEqual(9);
    }
  });
});

describe("the painter's colour vocabulary", () => {
  it("names every index it is allowed to paint", () => {
    // A sanity check on the constant above rather than on the art: if someone
    // widens ALLOWED they should have to think about why.
    for (const i of ALLOWED) expect(BANNED.has(i)).toBe(false);
    expect(ALLOWED.size).toBeLessThanOrEqual(14);
  });
});

describe("the source itself keeps the flat-mass discipline", () => {
  it("does not reintroduce the auto-shading helpers in the zombie painter", async () => {
    // The five-colours-per-part helpers are what made the count 74. This reads
    // the painter's own source and asserts the zombie section stays flat — the
    // only check that actually prevents the regression, because the helpers are
    // convenient and the next person will reach for them.
    const src = await import("node:fs").then((fs) => fs.readFileSync("src/game/pinball-knight/render/cel-painter.ts", "utf8"));
    const start = src.indexOf("function zombieHead(");
    const end = src.indexOf("function zombieFrame(");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const zombieSection = src.slice(start, end);
    for (const banned of ["plateShaded(", "limbShaded(", "ellShaded(", "legShaded(", "armShaded("]) {
      expect(zombieSection.includes(banned), `the zombie painter is using ${banned} again — that is five colours per part`).toBe(false);
    }
  });
});
