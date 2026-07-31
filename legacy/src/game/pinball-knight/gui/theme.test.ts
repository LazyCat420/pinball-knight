/**
 * EVERY UI COLOUR MUST SURVIVE THE DITHER.
 *
 * `theme.ts` names palette indices instead of hex so the palette snap is a
 * no-op and the UI is exact. That reasoning is HALF right, and the missing half
 * cost a rebuild: the UI composites BEFORE the ordered dither as well as before
 * the snap, so a flat fill does not arrive at the snap as itself. The shader
 * nudges every pixel by up to ±2/32 first, and the snap that follows is
 * LUMA-WEIGHTED — green error counts 0.59, red 0.30, blue 0.11 — so an entry
 * with a near neighbour across a HUE boundary splits between the two and the
 * surface renders as a mix of both.
 *
 * Observed: the panel body was set to `stone dark`, a plainly grey #2b303b, and
 * came out swamp green. Its neighbour under that metric is `rot shadow`.
 *
 * This test is the sweep that found it, kept. It reproduces the shader's own
 * dither amplitude and distance metric (see `finalNode` in pixel-pass.ts) and
 * fails if any colour the chrome is built from can land somewhere else.
 *
 * ── WHY "SAME HUE" AND NOT "NEVER DRIFTS" ──
 * Two of the three unstable pairs in this palette are between colours that are
 * visually the same thing (`void black`/`outline`, `skin shadow`/`leather mid`).
 * Forbidding those would forbid the near-black the whole UI sits on. So the
 * rule is not "never drift" but "never drift ACROSS A HUE", which is the
 * property that was actually violated and the one a reader can check by eye.
 */
import { describe, it, expect } from "vitest";
import { UI } from "./theme";
import { ART_PALETTE_SIZE, PALETTE_HEX } from "../render/palette";

/** The shader's weights, verbatim: `col.sub(pc).mul(vec3(0.3, 0.59, 0.11))`. */
const W = [0.3, 0.59, 0.11] as const;
/** `col.add(b.mul(2 / PALETTE_SIZE))`, with the bayer term spanning [-0.5, 0.5]. */
const DITHER = 2 / PALETTE_HEX.length;

const RGB = PALETTE_HEX.map((v) => [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]);

/**
 * Which HUE each entry belongs to. Drift within a hue is a value change and is
 * invisible on a dithered surface; drift across one changes what the colour IS.
 *
 * ⚠️ NOT palette.ts's section headings, and the difference is the whole point.
 * Those sections are SEMANTIC — "skin (23-25)" and "leather/wood (26-28)" name
 * what the tones are FOR. They are the same hue: #6b4436 and #6b4a2e are both
 * mid orange-brown, and palette.ts's own docblock groups them together when it
 * lists where the warm hues live. Splitting them here flagged `leather mid ↔
 * skin shadow` as a violation, which it is not — a 6/255 green shift on an
 * already-brown pixel is not something an eye can find.
 *
 * `stone dark ↔ rot shadow`, the crossing that caused this test, is a 28/255
 * BLUE swing that flips the channel order from B>G>R to G>R≈B. That is the
 * difference between grey and green, and it is what this list is drawn to
 * separate.
 */
const HUE = [
  ...Array(6).fill("cold-grey"), // 0-5 stone
  ...Array(4).fill("green"), // 6-9 rot
  ...Array(4).fill("red"), // 10-13 blood
  ...Array(5).fill("orange"), // 14-18 torch
  ...Array(4).fill("cold-grey"), // 19-22 steel — same hue as stone, lighter
  ...Array(6).fill("brown"), // 23-28 skin AND leather: one hue, two jobs
  ...Array(3).fill("cyan"), // 29-31 arcane
  // Ramp midpoints (32-54, 2026-07-31) wear their family's hue — a midpoint
  // IS its family, half a step darker or lighter. Leaving them off this list
  // made every landing on one read as "→ undefined", which flagged steel
  // textDim drifting onto a stone midpoint: a cold-grey landing on cold-grey.
  ...Array(4).fill("cold-grey"), // 32-35 stone mids
  ...Array(3).fill("green"), // 36-38 rot mids
  ...Array(3).fill("red"), // 39-41 blood mids
  ...Array(4).fill("orange"), // 42-45 torch mids
  ...Array(3).fill("cold-grey"), // 46-48 steel mids
  ...Array(2).fill("brown"), // 49-50 skin mids
  ...Array(2).fill("brown"), // 51-52 leather mids
  ...Array(2).fill("cyan"), // 53-54 arcane mids
];

// The shipped snap decides identity over the ART palette only (pixel-pass
// SNAP_N = artSize); midpoints are reachable through lighting rows, never by
// direct snap. The model mirrors that bound or it sweeps a shader that does
// not exist — the full-palette sweep was how a frame-wide maroon coldcrypt
// briefly shipped.
const RGB_SNAP = RGB.slice(0, ART_PALETTE_SIZE);
function snap(c: readonly number[], rgb: readonly (readonly number[])[] = RGB_SNAP): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < rgb.length; i++) {
    let d = 0;
    for (let k = 0; k < 3; k++) {
      const e = (c[k] - rgb[i][k]) * W[k];
      d += e * e;
    }
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Every entry this colour can snap to once the dither has had its way. */
function reachable(index: number, rgb: readonly (readonly number[])[] = RGB_SNAP, dither: number = DITHER): Set<number> {
  const c = rgb[index];
  const out = new Set<number>();
  // The shader adds a SCALAR to all three channels, so one axis is the whole
  // space of perturbations — 33 samples across it is far denser than the 16
  // distinct values a 4x4 Bayer matrix can actually produce.
  for (let s = -0.5; s <= 0.5001; s += 1 / 32) {
    out.add(snap([c[0] + s * dither, c[1] + s * dither, c[2] + s * dither], rgb));
  }
  return out;
}

/** theme.ts stores css; map back to the index so the sweep can run on it. */
function indexOfCss(css: string): number | null {
  const m = /^#([0-9a-f]{6})$/i.exec(css.trim());
  if (!m) return null; // `scrim` is an rgba() — alpha, never a flat fill
  return PALETTE_HEX.indexOf(parseInt(m[1], 16));
}

describe("the UI palette under the dither", () => {
  const named = Object.entries(UI)
    .map(([k, v]) => ({ k, i: indexOfCss(v) }))
    .filter((e): e is { k: string; i: number } => e.i !== null);

  it("names only real palette entries", () => {
    // Anti-vacuity twice over: an empty list would pass every case below, and a
    // -1 from indexOf would mean theme.ts had drifted off the palette entirely
    // — the exact thing naming indices is supposed to prevent.
    expect(named.length).toBeGreaterThan(10);
    for (const { k, i } of named) expect(i, `UI.${k} is not a palette entry`).toBeGreaterThanOrEqual(0);
  });

  it("never lets a chrome colour drift into another hue", () => {
    const crossings: string[] = [];
    for (const { k, i } of named) {
      for (const to of reachable(i)) {
        if (HUE[to] !== HUE[i]) crossings.push(`UI.${k} (${i} ${HUE[i]}) → ${to} ${HUE[to]}`);
      }
    }
    expect(crossings, "a UI surface will render as a different colour than it names").toEqual([]);
  });

  it("still catches the stone-dark → rot-shadow crossing that caused this", () => {
    // The negative control — run against the HISTORICAL 32-entry palette at
    // its historical amplitude, as a fixture. On the live palette this
    // crossing is now UNREACHABLE: the 2026-07-31 ramp midpoints put a nearer
    // in-family entry on both sides of every dither nudge, which is the
    // grain fix doing exactly what it claims. The control's job is unchanged —
    // prove the SWEEP can still see a crossing when one exists — so it sweeps
    // the input that had one.
    const RGB32 = RGB.slice(0, 32);
    const STONE_DARK = 2;
    expect([...reachable(STONE_DARK, RGB32, 2 / 32)]).toContain(6); // rot shadow
    expect(HUE[6]).not.toBe(HUE[STONE_DARK]);
    // And on the live palette the same crossing must stay gone — this line is
    // the claim the midpoints were shipped for.
    expect([...reachable(STONE_DARK)]).not.toContain(6);
  });
});
