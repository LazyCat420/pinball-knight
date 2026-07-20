/**
 * Pixel art for the slot symbols.
 *
 * The first pass drew these as Unicode glyphs (●◉⌒◆★☠) in Press Start 2P. That
 * font has no such glyphs, so every one silently fell back to a system face and
 * rendered as smooth anti-aliased shapes — round circles and a curly flipper in
 * the middle of a pixel game. Nothing errored; it just quietly wasn't pixel art.
 *
 * These are authored as pixel RUNS on a 16×16 grid instead. At this size a
 * curve is a lie, and hand-placing cells is both sharper and smaller than
 * rasterising vector shapes down.
 *
 * ── Shading rules these follow ──────────────────────────────────────────────
 * Five tones per symbol, not three, and the ramp is HUE-SHIFTED rather than a
 * lightness slider: shadows rotate cooler/bluer and desaturate slightly,
 * highlights rotate warmer/yellower. Shading purely by lightness is the single
 * most reliable way to make pixel art look muddy — the shadow ends up reading
 * as "the same colour, dimmer", which no real surface ever does.
 *
 * The outline is `ink`, a COLOURED dark of the symbol's own hue family, one
 * ramp step below the fill it touches. A pure-black outline at this size eats
 * the silhouette and flattens everything into stickers.
 *
 * The grid was 12×12 in the first version. 16×16 buys enough room for an actual
 * outline plus two shading steps on each side of the base tone; at 12 the
 * outline alone consumed the readable interior.
 */
import type { Symbol } from "./slots";

/** Logical grid every symbol is authored against. */
export const SYM_GRID = 16;

/** The shading ramp, darkest to lightest. `base` is the local colour. */
export type Tone = "ink" | "shade" | "base" | "lite" | "hi";

type Painter = (px: (x: number, y: number, w?: number, h?: number) => void, tone: (k: Tone) => void) => void;

const PAINTERS: Record<Symbol, Painter> = {
  // ● A pinball: a chrome sphere. Specular up-left, cool bounce light down-right.
  ball: (px, tone) => {
    tone("ink"); // silhouette — a 14px circle, outlined in its own dark
    px(5, 1, 6, 1);
    px(3, 2, 10, 1);
    px(2, 3, 12, 2);
    px(1, 5, 14, 6);
    px(2, 11, 12, 2);
    px(3, 13, 10, 1);
    px(5, 14, 6, 1);

    tone("base"); // the interior, inset one cell so the outline survives
    px(5, 2, 6, 1);
    px(3, 3, 10, 2);
    px(2, 5, 12, 6);
    px(3, 11, 10, 2);
    px(5, 13, 6, 1);

    tone("shade"); // terminator sweeping down-right
    px(10, 8, 4, 1);
    px(9, 9, 5, 1);
    px(8, 10, 6, 1);
    px(6, 11, 7, 1);
    px(5, 12, 8, 1);
    px(5, 13, 6, 1);

    tone("lite"); // the lit face, up-left
    px(4, 3, 6, 1);
    px(3, 4, 7, 1);
    px(3, 5, 6, 1);
    px(2, 6, 5, 1);
    px(2, 7, 4, 1);
    px(2, 8, 3, 1);

    tone("hi"); // hard specular — chrome has a small, bright, HARD hotspot
    px(5, 3, 3, 1);
    px(4, 4, 4, 1);
    px(4, 5, 3, 1);
    px(5, 6, 1, 1);
  },

  // ◉ A bumper: a ring skirt with a lit cap sitting proud of it.
  bumper: (px, tone) => {
    tone("ink"); // skirt silhouette
    px(5, 1, 6, 1);
    px(3, 2, 10, 1);
    px(2, 3, 12, 2);
    px(1, 5, 14, 6);
    px(2, 11, 12, 2);
    px(3, 13, 10, 1);
    px(5, 14, 6, 1);

    tone("shade"); // skirt body reads darker than the cap it frames
    px(5, 2, 6, 1);
    px(3, 3, 10, 2);
    px(2, 5, 12, 6);
    px(3, 11, 10, 2);
    px(5, 13, 6, 1);

    tone("base"); // upper-left of the skirt catches the room light
    px(5, 2, 6, 1);
    px(3, 3, 8, 1);
    px(3, 4, 7, 1);
    px(2, 5, 6, 1);
    px(2, 6, 5, 1);
    px(2, 7, 4, 1);

    tone("ink"); // cap rim
    px(6, 3, 4, 1);
    px(4, 4, 8, 1);
    px(3, 5, 10, 6);
    px(4, 11, 8, 1);
    px(6, 12, 4, 1);

    tone("lite"); // the cap itself
    px(6, 4, 4, 1);
    px(5, 5, 6, 1);
    px(4, 6, 8, 4);
    px(5, 10, 6, 1);
    px(6, 11, 4, 1);

    tone("hi"); // cap hotspot, offset up-left to match the ball
    px(5, 5, 3, 1);
    px(5, 6, 2, 2);
  },

  // ⌒ A flipper: an angled bat TAPERING from a fat hub end to a thin tip.
  //
  // The taper is the whole silhouette. A constant-thickness bar at this size
  // reads as a plank or a log — which is exactly what the first attempt looked
  // like — so the body loses a cell of height every couple of columns, and the
  // pivot hub is drawn last, on top, so it visibly anchors the wide end.
  flipper: (px, tone) => {
    tone("ink"); // outline pass — the bat one cell fat in every direction
    px(3, 8, 4, 6);
    px(5, 7, 4, 6);
    px(7, 6, 4, 5);
    px(9, 5, 4, 5);
    px(11, 4, 4, 4);

    tone("base"); // bat body, thinning toward the tip
    px(4, 9, 3, 4);
    px(6, 8, 3, 4);
    px(8, 7, 3, 3);
    px(10, 6, 3, 3);
    px(12, 5, 2, 2);

    tone("shade"); // underside — the face turned away from the cabinet lights
    px(4, 12, 3, 1);
    px(6, 11, 3, 1);
    px(8, 9, 3, 1);
    px(10, 8, 3, 1);
    px(12, 6, 2, 1);

    tone("lite"); // rubber along the striking edge
    px(4, 9, 3, 1);
    px(6, 8, 3, 1);
    px(8, 7, 3, 1);

    tone("hi"); // the tip is what hits the ball, so it gets the brightest run
    px(10, 6, 3, 1);
    px(12, 5, 2, 1);

    tone("ink"); // pivot hub — drawn last so it sits ON the bat, not under it
    px(4, 8, 3, 1);
    px(3, 9, 5, 1);
    px(2, 10, 7, 3);
    px(3, 13, 5, 1);
    px(4, 14, 3, 1);
    tone("shade");
    px(4, 9, 3, 1);
    px(3, 10, 5, 3);
    px(4, 13, 3, 1);
    tone("base");
    px(4, 10, 3, 2);
    tone("hi");
    px(4, 10, 2, 1);
  },

  // ◆ A drop target: a bevelled diamond plate with a centre stud.
  target: (px, tone) => {
    tone("ink"); // diamond silhouette
    px(7, 1, 2, 1);
    px(6, 2, 4, 1);
    px(5, 3, 6, 1);
    px(4, 4, 8, 1);
    px(3, 5, 10, 1);
    px(2, 6, 12, 1);
    px(1, 7, 14, 2);
    px(2, 9, 12, 1);
    px(3, 10, 10, 1);
    px(4, 11, 8, 1);
    px(5, 12, 6, 1);
    px(6, 13, 4, 1);
    px(7, 14, 2, 1);

    tone("base"); // plate face
    px(7, 2, 2, 1);
    px(6, 3, 4, 1);
    px(5, 4, 6, 1);
    px(4, 5, 8, 1);
    px(3, 6, 10, 1);
    px(2, 7, 12, 2);
    px(3, 9, 10, 1);
    px(4, 10, 8, 1);
    px(5, 11, 6, 1);
    px(6, 12, 4, 1);
    px(7, 13, 2, 1);

    tone("shade"); // the two facets pointing away from the light
    px(8, 9, 5, 1);
    px(8, 10, 4, 1);
    px(8, 11, 3, 1);
    px(8, 12, 2, 1);
    px(7, 13, 2, 1);

    tone("lite"); // the two facets pointing into it
    px(7, 2, 1, 1);
    px(6, 3, 2, 1);
    px(5, 4, 3, 1);
    px(4, 5, 4, 1);
    px(3, 6, 5, 1);
    px(2, 7, 6, 1);

    tone("hi"); // a single hard streak down the top-left bevel
    px(6, 3, 2, 1);
    px(5, 4, 2, 1);
    px(4, 5, 2, 1);

    tone("ink"); // centre stud
    px(7, 7, 2, 2);
    tone("hi");
    px(7, 7, 1, 1);
  },

  // ★ The jackpot star — the one that has to read instantly at a glance.
  //
  // The top point WIDENS gradually (2, 2, 4, 6) before the arms open out. The
  // first version jumped straight from a 2-wide point to the full 14-wide arm
  // row, which drew a star with a doorknob stuck on top — at this size the
  // point needs its own taper or the eye reads it as a separate object.
  jackpot: (px, tone) => {
    tone("ink"); // silhouette
    px(7, 2, 2, 1);
    px(6, 3, 4, 1);
    px(5, 4, 6, 1);
    px(1, 5, 14, 1);
    px(2, 6, 12, 2);
    px(3, 8, 10, 1);
    px(4, 9, 8, 1);
    px(3, 10, 4, 1);
    px(9, 10, 4, 1);
    px(2, 11, 4, 1);
    px(10, 11, 4, 1);
    px(2, 12, 3, 1);
    px(11, 12, 3, 1);
    px(1, 13, 3, 1);
    px(12, 13, 3, 1);

    tone("base"); // interior, inset one cell so the ink outline survives
    px(7, 3, 2, 1);
    px(6, 4, 4, 1);
    px(2, 6, 12, 1);
    px(3, 7, 10, 1);
    px(4, 8, 8, 1);
    px(5, 9, 6, 1);
    px(4, 10, 3, 1);
    px(9, 10, 3, 1);
    px(3, 11, 3, 1);
    px(10, 11, 3, 1);
    px(3, 12, 2, 1);
    px(11, 12, 2, 1);

    tone("shade"); // right arm and right leg fall away from the light
    px(9, 6, 5, 1);
    px(8, 7, 5, 1);
    px(8, 8, 4, 1);
    px(8, 9, 3, 1);
    px(9, 10, 3, 1);
    px(10, 11, 3, 1);
    px(11, 12, 2, 1);

    tone("lite"); // left arm and the top point catch it
    px(7, 3, 2, 1);
    px(6, 4, 3, 1);
    px(2, 6, 5, 1);
    px(3, 7, 4, 1);
    px(4, 8, 3, 1);
    px(4, 10, 3, 1);
    px(3, 11, 3, 1);

    tone("hi"); // gold wants a genuinely bright core or it reads as brass
    px(7, 3, 2, 1);
    px(6, 4, 2, 1);
    px(6, 6, 3, 1);
    px(6, 7, 2, 1);
  },

  // ☠ A skull: the strip's tax, and it should look like bad news.
  //
  // Painted as BONE with a blood-dark outline, not as a red shape. The first
  // version used the red ramp for the whole skull and the sockets vanished into
  // it — a dark feature on a dark fill has no silhouette. Bone against the near
  // black of the reel window is what makes the sockets read from across a room.
  skull: (px, tone) => {
    tone("ink"); // cranium + jaw silhouette
    px(4, 1, 8, 1);
    px(3, 2, 10, 1);
    px(2, 3, 12, 7);
    px(3, 10, 10, 1);
    px(5, 10, 6, 4);

    tone("base"); // bone
    px(5, 2, 6, 1);
    px(4, 3, 8, 1);
    px(3, 4, 10, 5);
    px(4, 9, 8, 1);
    px(6, 11, 4, 2);

    tone("shade"); // the right side of the cranium turns away, cool and blue
    px(10, 4, 3, 5);
    px(9, 9, 3, 1);
    px(8, 11, 2, 2);

    tone("lite"); // brow ridge and the lit upper-left of the dome
    px(5, 2, 4, 1);
    px(4, 3, 5, 1);
    px(3, 4, 4, 1);

    tone("hi"); // one hard glint across the dome — bone, not chrome, so it's short
    px(5, 2, 3, 1);
    px(4, 3, 2, 1);

    tone("ink"); // sockets, deep and square — the whole read of the symbol
    px(4, 5, 4, 3);
    px(9, 5, 4, 3);
    px(7, 8, 2, 2); // nasal cavity

    tone("shade"); // one lit cell low in each socket so they read as hollows
    px(5, 7, 1, 1);
    px(10, 7, 1, 1);

    tone("ink"); // the gap between the two front teeth
    px(7, 11, 1, 2);
  },
};

/**
 * The five tones a symbol is painted with.
 *
 * `lite` and `shade` are optional so a caller with only the old three-tone ramp
 * still typechecks — they fall back to `hi` and `ink`, which degrades to the
 * original flat look rather than throwing.
 */
export interface SymbolInk {
  base: string;
  hi: string;
  ink: string;
  /** One step above `base`, hue-rotated WARMER. Defaults to `hi`. */
  lite?: string;
  /** One step below `base`, hue-rotated COOLER. Defaults to `ink`. */
  shade?: string;
}

/**
 * Draw a symbol with its top-left at (ox, oy).
 *
 * `scale` is device pixels per grid cell — pass a WHOLE number or the symbol
 * fringes, which defeats the entire point of authoring it by hand.
 */
export function drawSymbol(
  ctx: CanvasRenderingContext2D,
  sym: Symbol,
  ink: SymbolInk,
  ox: number,
  oy: number,
  scale: number,
): void {
  const s = Math.max(1, Math.floor(scale));
  const x0 = Math.round(ox);
  const y0 = Math.round(oy);
  const px = (x: number, y: number, w = 1, h = 1): void => {
    ctx.fillRect(x0 + x * s, y0 + y * s, w * s, h * s);
  };
  const ramp: Record<Tone, string> = {
    ink: ink.ink,
    shade: ink.shade ?? ink.ink,
    base: ink.base,
    lite: ink.lite ?? ink.hi,
    hi: ink.hi,
  };
  const tone = (k: Tone): void => {
    ctx.fillStyle = ramp[k];
  };
  PAINTERS[sym](px, tone);
}

/** Every symbol that has art — used by the coverage test. */
export function paintedSymbols(): Symbol[] {
  return Object.keys(PAINTERS) as Symbol[];
}
