/**
 * THE UI PALETTE — every colour is a Cold Crypt entry, by index.
 *
 * The DOM overlays used their own hex soup (`#e8dcc0`, `#9a8f77`, `#4a3d28`,
 * `#171310`…) chosen by eye to "match" the art. It could not actually match:
 * DOM sat outside the pixel pass, so those colours were the only things on
 * screen that never went through the 32-colour snap.
 *
 * Now the UI is composited BEFORE the quantizer, which changes the rule. Any
 * colour used here that is not already a palette entry gets snapped to the
 * nearest one anyway — so picking off-palette colours means the shader silently
 * decides what the UI looks like. Naming palette indices instead makes the snap
 * a NO-OP and the UI exact.
 *
 * Three of the old menu's colours turned out to already be palette entries
 * (`GOLD #f0a63c` = 16 flame, `#d95763` = 13 blood light, `#6fd0e8` = 31 arcane
 * light) and the border `#4a3d28` was within a hair of 27 leather dark — the
 * old sheet had been converging on this palette by hand all along.
 *
 * ── ON TEXT CONTRAST ──
 * Body text is 21 (steel light) on 0/1 (void/outline). That is a deliberate
 * step DOWN in contrast from the old `#e8dcc0` cream: at 8px on a scanlined,
 * dithered surface, maximum-contrast text shimmers as the scanline crosses it.
 * Headings take 17 (flame light) to carry the warmth the cream used to.
 */
import { paletteCss } from "../render/palette";

/** Palette index → css. Re-exported so screens never hardcode a hex string. */
export const C = paletteCss;

export const UI = {
  /** Full-screen scrim behind a modal sheet. Alpha, so the world reads through. */
  scrim: "rgba(11,13,18,0.82)", // palette 0 at 82%

  /** Sheet body and its two-tone frame. */
  sheet: C(1), // outline — the darkest thing that is not the void
  sheetEdge: C(27), // leather dark — the old #4a3d28, on-palette
  sheetEdgeLit: C(28), // leather mid, for the top/left bevel

  /** Rows and wells sunk into the sheet. */
  well: C(0),
  wellEdge: C(2), // stone dark

  /** Type. */
  text: C(21), // steel light — body
  textDim: C(20), // steel mid — hints, units, secondary
  textFaint: C(19), // steel dark — disabled, "not yet met"
  heading: C(17), // flame light
  gold: C(16), // flame — currency, the accent the whole UI is built around

  /** State colours, all already in the ramp. */
  good: C(9), // rot light — affordable, ON, unlocked
  danger: C(13), // blood light — abandon, cannot afford
  arcane: C(31), // arcane light — magic, selection

  /** Focus ring. The single most important colour in a gamepad UI. */
  focus: C(18), // flame core — brightest entry in the palette
} as const;

/**
 * THE GRID. Every offset, size and gap in the UI is a multiple of this.
 *
 * Press Start 2P renders on an 8px cell. Text placed off that cell antialiases,
 * and antialiased text on a quantized+dithered surface does not soften — it
 * speckles, because each grey edge pixel snaps to a different palette entry.
 * The repo already learned this once (`canvas fillText AA needs binarized
 * sprites, fonts at NATIVE grid`), which is why sizes below are 8/16/24 and
 * never 9, 11 or 13 like the DOM sheet used.
 */
export const GRID = 8;

/** Snap any coordinate to the grid. Use it on every rect the UI draws. */
export function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}

/** Snap to whole pixels — for things that may sit between grid cells. */
export function px(v: number): number {
  return Math.round(v);
}

export const FONT = {
  /** Labels/headings. Sizes MUST be multiples of 8. */
  label: (size: 8 | 16 | 24 | 32): string => `${size}px 'Press Start 2P'`,
  /** Numerals — VT323 is condensed and reads well small. */
  num: (size: number): string => `${size}px VT323`,
} as const;

/** Row metrics, so every screen agrees on how tall a line of UI is. */
export const ROW_H = 24;
export const ROW_GAP = 4;
export const PAD = 16;
