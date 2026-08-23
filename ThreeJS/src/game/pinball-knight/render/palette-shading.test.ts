/**
 * Proves the row tables do what a multiply cannot, and pins the diagnosis that
 * motivated them so nobody "simplifies" shading back to a multiply later.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createCanvas } from "canvas";
import { snapColor } from "../engine/render/sprite";
import { installPalette, PALETTE_HEX, PALETTE_SIZE } from "./palette";
import { FAMILIES, SHADE_DOWN, SHADE_UP, familyOf, shadeBy, shadeTable } from "./palette-shading";

const realDoc = (globalThis as { document?: unknown }).document;
beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: (t: string) => (t === "canvas" ? createCanvas(1, 1) : {}),
  };
  installPalette();
});
afterAll(() => { (globalThis as { document?: unknown }).document = realDoc; });

const rgb = (i: number): [number, number, number] => [
  (PALETTE_HEX[i] >> 16) & 255, (PALETTE_HEX[i] >> 8) & 255, PALETTE_HEX[i] & 255,
];
const luma = (i: number): number => { const [r, g, b] = rgb(i); return 0.3 * r + 0.59 * g + 0.11 * b; };

describe("the palette covers every entry exactly once", () => {
  it("families partition the palette", () => {
    const seen = FAMILIES.flat();
    expect(seen.length).toBe(PALETTE_SIZE);
    expect(new Set(seen).size).toBe(PALETTE_SIZE);
  });
});

describe("THE DIAGNOSIS — why shading cannot be a multiply", () => {
  /**
   * This is the measurement that justifies the whole module. If a future palette
   * ever makes it FALSE — i.e. multiply-then-snap keeps colours in-family — the
   * row walk is no longer buying anything and this test should be the thing that
   * says so, loudly, rather than the tables quietly becoming ceremony.
   */
  it("multiply-then-snap throws most of the palette into another family", () => {
    const defectors: string[] = [];
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const fam = familyOf(i);
      const [r, g, b] = rgb(i);
      for (let m = 0.95; m >= 0.35; m -= 0.05) {
        const s = snapColor(r * m, g * m, b * m);
        // Reaching ink/void on the way down is legitimate darkening, not a hue jump.
        if (s !== 0 && s !== 1 && familyOf(s) !== fam) { defectors.push(`${i}@${m.toFixed(2)}→${s}`); break; }
      }
    }
    // Measured 2026-07-29: 24 of 32. The floor entry (28) defects at 0.95.
    expect(defectors.length, `entries that leave their family under a plain multiply:\n${defectors.join("  ")}`)
      .toBeGreaterThan(15);
  });

  it("the tavern floor changes hue at five percent shadow", () => {
    // 28 is leather mid — the wood the tavern floor and the stiltneck's stilts
    // are made of, and the largest lit surface on that screen.
    const [r, g, b] = rgb(28);
    expect(familyOf(snapColor(r * 0.95, g * 0.95, b * 0.95))).not.toBe(familyOf(28));
    // ...and the row walk does not.
    expect(familyOf(SHADE_DOWN[28])).toBe(familyOf(28));
  });
});

describe("SHADE_DOWN", () => {
  it("never leaves the family except by terminating at ink/void", () => {
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const d = SHADE_DOWN[i];
      if (d === 0 || d === 1) continue;
      expect(familyOf(d), `entry ${i} shaded to ${d}, a different family`).toBe(familyOf(i));
    }
  });

  it("always gets darker, never brighter", () => {
    for (let i = 2; i < PALETTE_SIZE; i++) {
      expect(luma(SHADE_DOWN[i]), `entry ${i} (luma ${luma(i).toFixed(1)}) shaded UP to ${SHADE_DOWN[i]}`)
        .toBeLessThan(luma(i));
    }
  });

  it("reaches void from every entry and STAYS there", () => {
    // A capped walk that stops mid-cascade is a shadow that never gets dark
    // enough; a walk that cycles never converges at all. Both have shipped here
    // before under other names, so this is asserted rather than assumed.
    for (let i = 0; i < PALETTE_SIZE; i++) {
      let v = i;
      for (let k = 0; k < PALETTE_SIZE + 2; k++) v = SHADE_DOWN[v];
      expect(v, `entry ${i} did not converge to void`).toBe(0);
    }
    expect(SHADE_DOWN[0]).toBe(0);
  });

  it("takes at most one step per ramp position — no family is skipped through", () => {
    for (const fam of FAMILIES) {
      for (let i = 0; i + 1 < fam.length; i++) expect(SHADE_DOWN[fam[i]]).toBe(fam[i + 1]);
    }
  });
});

describe("SHADE_UP", () => {
  it("is the inverse of SHADE_DOWN inside a ramp", () => {
    for (const fam of FAMILIES) {
      for (let i = 0; i + 1 < fam.length; i++) {
        const down = SHADE_DOWN[fam[i]];
        // Ink and void are SHARED TERMINATORS, not ordinary ramp members: every
        // family falls through to them, so they cannot know which family to
        // brighten back into. Stone owns them positionally (it is listed 5→0),
        // which would otherwise make `SHADE_UP[1]` = stone dark and turn every
        // outline in the game into masonry the moment a torch passed.
        // Round-tripping is a property of ramp INTERIORS only.
        if (down === 0 || down === 1) continue;
        expect(SHADE_UP[down]).toBe(fam[i]);
      }
    }
  });

  it("saturates at the brightest entry rather than inventing a highlight", () => {
    for (const fam of FAMILIES) expect(SHADE_UP[fam[0]]).toBe(fam[0]);
  });

  it("does not brighten ink or void into masonry", () => {
    expect(SHADE_UP[0]).toBe(0);
    expect(SHADE_UP[1]).toBe(1);
  });
});

describe("shadeTable", () => {
  it("row 0 is identity and row s matches s walks", () => {
    const steps = 6;
    const t = shadeTable(steps);
    for (let i = 0; i < PALETTE_SIZE; i++) {
      expect(t[i]).toBe(i);
      for (let s = 1; s <= steps; s++) expect(t[s * PALETTE_SIZE + i]).toBe(shadeBy(i, s));
    }
  });

  it("is fully saturated by the time the deepest row is reached", () => {
    // The shader clamps its shade term to the table's last row, so that row must
    // be the terminal state or the deepest shadow in the game is arbitrary.
    const steps = 8;
    const t = shadeTable(steps);
    for (let i = 0; i < PALETTE_SIZE; i++) expect(t[steps * PALETTE_SIZE + i]).toBe(0);
  });
});
