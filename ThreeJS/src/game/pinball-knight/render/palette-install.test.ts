/**
 * THE BOOT PATH MUST INSTALL THE REAL SHADE TABLE.
 *
 * Companion to `engine/config-mirror.test.ts`, and it exists for the same
 * reason: `installEngine()` hand-builds a `PaletteSource` literal that
 * duplicates `installPalette()` in `render/palette.ts`, and a duplicated
 * literal drifts.
 *
 * ## The drift this catches, which shipped
 *
 * `installEngine()` omitted `shadeDown`. `setEnginePalette` then falls back to
 * `descendingChain(size)` — a plain `i → i-1` walk — which is correct for the
 * greyscale standalone default and WRONG for this palette, whose 32 entries are
 * eight material families laid out back to back. `render/palette.ts` says so in
 * a comment. Nothing enforced it.
 *
 * The pixel pass bakes that table into a texture ONCE, in `buildShadedPalette`
 * at `createPixelPass` time, and `launchDungeonGame` calls `installEngine()`
 * immediately before `installRenderer()`. So the fallback was not merely
 * possible, it was what every session got — the only caller that passes the
 * real table is a lazy monster-portrait path, and the launch overwrites it.
 *
 * ## Why no existing test saw it
 *
 * `palette-shading.test.ts` and `palette-lock.test.ts` assert against
 * `SHADE_DOWN` directly. They prove the table is right. They cannot prove
 * anyone receives it.
 *
 * ## Why it was not caught by looking, either
 *
 * The stone family is indices 0-5 in descending order, so `i-1` IS the correct
 * stone ramp — and the Cold Crypt, the one all-stone biome, renders bit
 * identically under both tables. Verification covered floor 1 and the tavern.
 * Every OTHER biome's masonry walks straight out of its family: rot greys out,
 * arcane blue shades to leather brown, blood never darkens at all.
 *
 * That is the shape of the whole bug, so the per-biome case is asserted at the
 * bottom rather than left to the general invariant.
 */
import { describe, it, expect } from "vitest";
import { installEngine } from "../GameEngine";
import { enginePalette } from "../engine/palette-source";
import { PALETTE_HEX, PALETTE_SIZE } from "./palette";
import { FAMILIES, SHADE_DOWN, familyOf } from "./palette-shading";
import { BIOME_STONE } from "../maze/build";

/** Perceived brightness under the same weights the quantizer's metric uses. */
function luma(index: number): number {
  const hex = PALETTE_HEX[index];
  return (
    (0.3 * ((hex >> 16) & 0xff) + 0.59 * ((hex >> 8) & 0xff) + 0.11 * (hex & 0xff)) / 255
  );
}

/** The fallback `setEnginePalette` uses when a caller omits `shadeDown`. */
function descendingChain(n: number): Uint8Array {
  const t = new Uint8Array(n);
  for (let i = 0; i < n; i++) t[i] = Math.max(0, i - 1);
  return t;
}

/**
 * Walk `table` from `start` until it reaches its fixed point, capped so a
 * cyclic table fails as a bad walk instead of hanging the suite.
 */
function walk(table: Uint8Array, start: number): number[] {
  const out = [start];
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const next = table[out[out.length - 1]];
    if (next === out[out.length - 1]) return out;
    out.push(next);
  }
  return out;
}

/**
 * Every step of a shade walk must stay in the entry's own family until it
 * leaves for the shared terminator (ink, then void), and must never brighten.
 * Returns the offending steps so a failure names them.
 */
function violations(table: Uint8Array): string[] {
  const bad: string[] = [];
  for (let i = 0; i < PALETTE_SIZE; i++) {
    for (const [from, to] of walk(table, i)
      .slice(0, -1)
      .map((v, k, a) => [v, a[k + 1] ?? table[v]] as const)) {
      if (luma(to) > luma(from)) bad.push(`${from}→${to} BRIGHTENS (${luma(from).toFixed(3)}→${luma(to).toFixed(3)})`);
      // 1 (ink) and 0 (void) are the shared terminator every family falls
      // through to, so leaving for them is the design, not a violation.
      const crossed = familyOf(from) !== familyOf(to) && to !== 1 && to !== 0;
      if (crossed) bad.push(`${from}→${to} LEAVES FAMILY ${familyOf(from)}→${familyOf(to)}`);
    }
  }
  return bad;
}

describe("the shipped boot path installs the family-preserving shade table", () => {
  it("hands the pixel pass a table at all, sized to this palette", () => {
    installEngine();
    expect(enginePalette.shadeDown).toBeDefined();
    expect(enginePalette.shadeDown!()).toHaveLength(PALETTE_SIZE);
  });

  it("hands it THE table — not a same-shaped stand-in", () => {
    installEngine();
    expect(Array.from(enginePalette.shadeDown!())).toEqual(Array.from(SHADE_DOWN));
  });

  it("never brightens and never leaves a family except into ink/void", () => {
    installEngine();
    expect(violations(enginePalette.shadeDown!())).toEqual([]);
  });

  it("reaches void from every entry, so the deepest shadow is black", () => {
    installEngine();
    const table = enginePalette.shadeDown!();
    for (let i = 0; i < PALETTE_SIZE; i++) {
      expect(walk(table, i).at(-1), `entry ${i} bottoms out somewhere other than void`).toBe(0);
    }
  });

  // ── The negative control ──────────────────────────────────────────────────
  //
  // Without this the suite cannot distinguish "the invariant holds" from "the
  // invariant is unfalsifiable". It also records what the shipped fallback
  // actually did, which is the whole reason this file exists.
  it("would FAIL on the fallback the omission selected", () => {
    const bad = violations(descendingChain(PALETTE_SIZE));
    expect(bad.length).toBeGreaterThan(0);
    // The specific step named in render/palette.ts's warning: leather shadow
    // shades to skin light — a different material, and BRIGHTER.
    expect(bad).toContain("26→25 BRIGHTENS (0.123→0.674)");
  });
});

describe("every biome's masonry shades as one material", () => {
  // BIOME_STONE remaps stone dark/mid/light per depth, so these three entries
  // are the environment — floors, wall faces, caps, cracks, pilasters. If any
  // of them walks into a foreign family the whole floor changes hue in shadow,
  // which is exactly what indexed lighting was built to prevent.
  for (const [i, row] of BIOME_STONE.entries()) {
    it(`biome ${i} masonry [${row}] stays in-family all the way down`, () => {
      installEngine();
      const table = enginePalette.shadeDown!();
      for (const entry of row) {
        const steps = walk(table, entry);
        for (let k = 1; k < steps.length; k++) {
          const [from, to] = [steps[k - 1], steps[k]];
          if (to === 1 || to === 0) break; // fell through to the terminator
          expect(familyOf(to), `${from}→${to} left family ${familyOf(from)}`).toBe(familyOf(from));
        }
      }
    });
  }

  it("paints each row's DARK and MID from one family", () => {
    // The rule is about what a single wall texture does under shadow. Mortar
    // (dark) and face (mid) cover most of every surface and take most of the
    // shading, so if they sit in different families the wall's two main tones
    // diverge in HUE as it darkens and never agree again. The Bloodworks row
    // was blood + leather + skin — three materials pretending to be one rock.
    //
    // The LIGHT tone is deliberately exempt. It is a sparse flagstone highlight
    // that shades least, and two families have nothing at the baseline's 0.458:
    // arcane jumps 0.368 → 0.712, so the Arcane Deep borrows neutral stone for
    // its highlight on purpose. (Not a bloom concern — 31's LINEAR luma is
    // 0.509, well under BLOOM_THRESHOLD 0.7. It is purely a value problem.)
    for (const [i, row] of BIOME_STONE.entries()) {
      const [dark, mid] = row;
      expect(familyOf(mid), `biome ${i}: dark ${dark} and mid ${mid} are different materials`).toBe(
        familyOf(dark),
      );
    }
  });

  it("holds the Cold Crypt's value spread, so no biome is merely darker", () => {
    // A biome that is only darker is not a different biome, it is a
    // readability problem. Tolerance is set where it separates the four
    // shipping rows (max deviation 0.063, the Arcane Deep's mid) from a tone
    // that is a whole rung out of place (the old Bloodworks dark sat 0.074
    // below baseline — already near ink, so its mortar read black).
    const BASELINE = BIOME_STONE[0].map(luma);
    for (const [i, row] of BIOME_STONE.entries()) {
      const got = row.map(luma);
      for (let k = 0; k < 3; k++) {
        expect(
          Math.abs(got[k] - BASELINE[k]),
          `biome ${i} tone ${k} (entry ${row[k]}) is ${got[k].toFixed(3)} vs baseline ${BASELINE[k].toFixed(3)}`,
        ).toBeLessThan(0.07);
      }
      expect(got[0], `biome ${i} tones are not dark → mid → light`).toBeLessThan(got[1]);
      expect(got[1], `biome ${i} tones are not dark → mid → light`).toBeLessThan(got[2]);
    }
  });
});
