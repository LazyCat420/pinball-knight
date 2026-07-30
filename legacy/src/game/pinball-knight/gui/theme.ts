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

  /**
   * Sheet body and its two-tone frame.
   *
   * ── WHY THE BODY IS STONE AND NOT NEAR-BLACK ──
   * It was C(1), the darkest thing that is not the void, which put a near-black
   * panel on a near-black scrim and left the 1px border doing ALL the work of
   * saying "this is a surface". The result read as a terminal: every element the
   * same weight, every edge a hairline, nothing with any thickness to it.
   *
   * The id-software menus this game is otherwise dressed like never do that.
   * Wolfenstein 3D's panel is a MID-tone plate and its edges are chiselled — a
   * lit top-left, a shadowed bottom-right, three or four pixels each. Contrast
   * comes from the bevel, not from an outline on black, which is what makes the
   * thing look like a slab of stone rather than a rectangle of ink.
   *
   * So the body moves onto a mid-tone ramp and the parts stack in VALUE order:
   * void (0) under a sunken well, outline (1) as the shadowed edge, the plate,
   * a raised key one step above it, a lit edge above that, and a bright rivet.
   * That is a five-step legible depth cue inside one hue family — the lesson
   * from `separate on VALUE not hue in a tight palette`, applied to the chrome
   * instead of to a sprite.
   *
   * ⚠️ WHY THE LEATHER RAMP AND NOT THE STONE ONE. Stone was the obvious pick
   * and it came out GREEN. The UI composites BEFORE the ordered dither and the
   * palette snap, so a flat fill is not guaranteed to survive as itself: the
   * dither nudges every pixel by up to ±2/32 and the snap is LUMA-WEIGHTED, so
   * an entry with a near neighbour across a hue boundary splits between the two.
   *
   * Swept exhaustively over all 32 entries against the shader's own dither
   * amplitude and metric, exactly THREE pairs are unstable:
   *
   *     0 void black    ↔  1 outline        (both near-black — invisible)
   *     2 stone dark    ↔  6 ROT SHADOW     ← a grey panel that renders green
   *    23 skin shadow   ↔ 28 leather mid    (both mid-brown — invisible)
   *
   * `2` was the plate. Half its pixels landed on rot shadow and the panel read
   * as swamp. Leather shadow is a dark warm brown that is stable under the same
   * sweep, is a truer match for the id-software panels this is dressed after
   * anyway, and puts the plate in the same family as the keyline and bevel it
   * already had. Re-run the sweep before moving any of these.
   */
  sheet: C(26), // leather shadow — the plate itself
  sheetEdge: C(27), // leather dark — the keyline around the whole plate
  sheetEdgeLit: C(28), // leather mid, for the top/left bevel

  /**
   * A key sitting PROUD of the plate — buttons, tabs, the focused row's face.
   *
   * Without this a button filled with `sheet` on a `sheet` panel and was
   * distinguishable only by its 1px accent border. One value up the same ramp
   * plus a bevel is the whole Wolfenstein control vocabulary — those menus do
   * not tint their buttons either; the chisel is what says "press me".
   */
  raised: C(27), // leather dark

  /**
   * The chisel. Lit edge above/left, shadowed edge below/right.
   *
   * The highlight is TWO steps off the key face rather than one. At one step
   * (leather mid on leather dark) the bevel was technically present and read as
   * nothing — a 1px edge has to carry its whole contrast in a single row of
   * pixels, and the scanline dim takes 14% of it before the player sees it.
   * Skin mid is the next rung of the same brown, which is what makes the chisel
   * land as a highlight rather than as a colour change.
   */
  bevelLit: C(24), // skin mid — the same hue, two rungs brighter
  bevelShade: C(1), // outline
  /**
   * Corner studs. C(5) is the entry the palette census found NOTHING names —
   * the quantizer routes 3.55% of painted pixels onto it anyway, so it is the
   * one tone in the ramp that is definitely available and definitely in-family.
   */
  rivet: C(5), // stone highlight

  /** Rows and wells sunk into the sheet. */
  well: C(0),
  wellEdge: C(1), // outline — one step under the plate, so a well reads sunken

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

  /**
   * THE SELECTION, as a surface rather than as an outline.
   *
   * A focus ring alone is a 1px hairline, which is the one thing a UI cannot
   * afford to make its most important state out of — it is the first casualty
   * of the scanline dim and the palette snap. Doom highlights the whole row and
   * puts a cursor beside it, so selection survives being glanced at.
   *
   * Blood dark under flame core is the only pairing in this palette that is both
   * a hard value jump and warm on both sides; steel/arcane would fight the gold
   * the rest of the chrome is built on.
   */
  selectFace: C(11), // blood dark — the focused row's fill
  selectEdge: C(12), // blood mid — its chisel
  /** The selector glyph itself. Same tone as `focus`, deliberately: one cursor. */
  cursor: C(18), // flame core
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
