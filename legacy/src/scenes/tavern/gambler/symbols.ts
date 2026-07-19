/**
 * Pixel art for the slot symbols.
 *
 * The first pass drew these as Unicode glyphs (●◉⌒◆★☠) in Press Start 2P. That
 * font has no such glyphs, so every one silently fell back to a system face and
 * rendered as smooth anti-aliased shapes — round circles and a curly flipper in
 * the middle of a pixel game. Nothing errored; it just quietly wasn't pixel art.
 *
 * These are authored as pixel RUNS on a 12×12 grid instead. At this size a
 * curve is a lie, and hand-placing cells is both sharper and smaller than
 * rasterising vector shapes down.
 */
import type { Symbol } from "./slots";

/** Logical grid every symbol is authored against. */
export const SYM_GRID = 12;

type Painter = (px: (x: number, y: number, w?: number, h?: number) => void, tone: (k: "base" | "hi" | "ink") => void) => void;

const PAINTERS: Record<Symbol, Painter> = {
  // ● A pinball: a sphere with a specular highlight.
  ball: (px, tone) => {
    tone("base");
    px(4, 2, 4, 1);
    px(3, 3, 6, 1);
    px(2, 4, 8, 4);
    px(3, 8, 6, 1);
    px(4, 9, 4, 1);
    tone("hi");
    px(4, 4, 2, 2); // highlight, up-left
    tone("ink");
    px(6, 7, 2, 1); // shadow, down-right
  },

  // ◉ A bumper: a ring with a lit cap.
  bumper: (px, tone) => {
    tone("ink");
    px(3, 2, 6, 1);
    px(2, 3, 1, 6);
    px(9, 3, 1, 6);
    px(3, 9, 6, 1);
    tone("base");
    px(3, 3, 6, 6);
    tone("hi");
    px(5, 4, 2, 2);
    px(4, 5, 4, 2);
  },

  // ⌒ A flipper: an angled bat with a pivot.
  flipper: (px, tone) => {
    tone("base");
    px(2, 7, 3, 2);
    px(4, 6, 3, 2);
    px(6, 5, 3, 2);
    px(8, 4, 2, 2);
    tone("hi");
    px(2, 7, 3, 1);
    px(4, 6, 3, 1);
    tone("ink");
    px(2, 9, 3, 1); // underside
  },

  // ◆ A drop target: a diamond plate.
  target: (px, tone) => {
    tone("base");
    px(5, 1, 2, 1);
    px(4, 2, 4, 1);
    px(3, 3, 6, 1);
    px(2, 4, 8, 2);
    px(3, 6, 6, 1);
    px(4, 7, 4, 1);
    px(5, 8, 2, 1);
    tone("hi");
    px(5, 2, 2, 2);
    tone("ink");
    px(5, 6, 2, 1);
  },

  // ★ The jackpot star — the one that has to read instantly at a glance.
  jackpot: (px, tone) => {
    tone("base");
    px(5, 0, 2, 4); // top point
    px(0, 4, 12, 2); // arms
    px(4, 4, 4, 3); // body
    px(3, 7, 2, 3); // left leg
    px(7, 7, 2, 3); // right leg
    tone("hi");
    px(5, 4, 2, 2); // bright core
    px(5, 1, 2, 1);
  },

  // ☠ A skull: the strip's tax, and it should look like bad news.
  skull: (px, tone) => {
    tone("base");
    px(3, 2, 6, 5);
    px(4, 7, 4, 2);
    tone("ink");
    px(4, 4, 2, 2); // left socket
    px(7, 4, 2, 2); // right socket
    px(6, 6, 1, 1); // nose
    px(5, 8, 1, 1); // teeth gaps
    px(7, 8, 1, 1);
    tone("hi");
    px(4, 2, 4, 1); // dome light
  },
};

export interface SymbolInk {
  base: string;
  hi: string;
  ink: string;
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
  const px = (x: number, y: number, w = 1, h = 1): void => {
    ctx.fillRect(ox + x * s, oy + y * s, w * s, h * s);
  };
  const tone = (k: "base" | "hi" | "ink"): void => {
    ctx.fillStyle = ink[k];
  };
  PAINTERS[sym](px, tone);
}

/** Every symbol that has art — used by the coverage test. */
export function paintedSymbols(): Symbol[] {
  return Object.keys(PAINTERS) as Symbol[];
}
