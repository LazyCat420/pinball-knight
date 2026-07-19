/**
 * PIXEL ICONS — turn a drawing function into a cached pixel-art bitmap.
 *
 * The dungeon authors all its art as `FramePaint`s: functions that draw smooth
 * canvas-2D paths, which are then crushed to a pixel grid (downscale → ordered
 * dither → palette snap → nearest upscale). That crush is what makes the output
 * read as pixel art rather than as smooth vector shapes.
 *
 * This module is the general, palette-agnostic version of that idea, for anything
 * that needs small pixel icons on a 2D canvas. The dungeon's own
 * `render/sprite.ts` keeps its Cold-Crypt-specific path (it snaps to the game's
 * 32-colour ramp and feeds THREE textures); this one takes whatever palette you
 * hand it, so the site map can keep its per-room colours.
 *
 * The crush is NOT cheap. Everything here is cached by key — rasterize once at
 * boot, draw the cached canvas every frame.
 */

import { clamp } from "../utils/math";

/** A drawing function, given a context sized `size × size`. */
export type IconPaint = (ctx: CanvasRenderingContext2D, size: number) => void;

/** 4×4 Bayer matrix — ordered dithering, so ramps stipple instead of banding. */
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** How hard the dither biases a pixel before the palette snap. */
const DITHER_AMP = 6;

/** Below this alpha a pixel is cut out entirely — a hard silhouette, not a fringe. */
const ALPHA_CUTOFF = 128;

export interface RasterizeOptions {
  /** Output edge length in pixel-art pixels (e.g. 16 for a map marker). */
  size: number;
  /**
   * Optional palette to snap to, as `#rrggbb` strings. Omit to keep the painted
   * colours as-is (still hard-alpha'd and grid-snapped, just not quantised).
   */
  palette?: string[];
  /** Ordered dithering before the snap. Only meaningful with a palette. */
  dither?: boolean;
  /**
   * Supersample factor for the initial draw. The painter draws at
   * `size × oversample`, then it's area-downscaled to `size` — which is what
   * turns smooth curves into clean pixel steps instead of jagged ones.
   */
  oversample?: number;
}

const cache = new Map<string, HTMLCanvasElement>();

/** Parse `#rrggbb` into an [r,g,b] triple. */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Rasterize `paint` to a pixel-art canvas, memoised on `key`.
 *
 * `key` must capture everything that affects the output — size, palette and any
 * parameters baked into the painter (a room's colour, say). A stale key returns
 * the wrong icon, which is the one failure mode worth being careful about.
 */
export function rasterizeIcon(key: string, paint: IconPaint, opts: RasterizeOptions): HTMLCanvasElement {
  const cached = cache.get(key);
  if (cached) return cached;

  const { size, palette, dither = true, oversample = 4 } = opts;

  // 1. Draw big and smooth, so curves have real information to downscale from.
  const hi = document.createElement("canvas");
  hi.width = size * oversample;
  hi.height = size * oversample;
  const hctx = hi.getContext("2d")!;
  hctx.imageSmoothingEnabled = true;
  hctx.save();
  hctx.scale(oversample, oversample);
  paint(hctx, size);
  hctx.restore();

  // 2. Area-downscale to the target grid.
  const out = document.createElement("canvas");
  out.width = size;
  out.height = size;
  const octx = out.getContext("2d")!;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(hi, 0, 0, size, size);

  // 3. Hard alpha + optional palette snap.
  const img = octx.getImageData(0, 0, size, size);
  const d = img.data;
  const pal = palette?.map(hexToRgb);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (d[i + 3] < ALPHA_CUTOFF) {
        d[i + 3] = 0;
        continue;
      }
      d[i + 3] = 255;
      if (!pal || pal.length === 0) continue;

      const bias = dither ? BAYER4[y & 3][x & 3] * DITHER_AMP : 0;
      const cr = d[i] + bias;
      const cg = d[i + 1] + bias;
      const cb = d[i + 2] + bias;

      let best = 0;
      let bestDist = Infinity;
      for (let p = 0; p < pal.length; p++) {
        // Luma-weighted distance — matching perceived brightness matters more
        // than matching raw channel values.
        const dr = (cr - pal[p][0]) * 0.3;
        const dg = (cg - pal[p][1]) * 0.59;
        const db = (cb - pal[p][2]) * 0.11;
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) {
          bestDist = dist;
          best = p;
        }
      }
      d[i] = pal[best][0];
      d[i + 1] = pal[best][1];
      d[i + 2] = pal[best][2];
    }
  }
  octx.putImageData(img, 0, 0);

  cache.set(key, out);
  return out;
}

/** Drop every cached icon. For hot-reload and tests; not needed in normal play. */
export function clearIconCache(): void {
  cache.clear();
}

/**
 * Derive a small ramp (dark / base / light) from one colour.
 *
 * The site map gives each room its own hue, so it can't adopt the dungeon's
 * fixed 32-colour palette without flattening every room into the same cold
 * greys. This keeps the room's identity colour and just bands it, which is what
 * actually reads as pixel art — few steps, hard edges.
 */
export function rampFrom(hex: string, steps = 3): string[] {
  const [r, g, b] = hexToRgb(hex);
  const out: string[] = [];
  for (let i = 0; i < steps; i++) {
    // -40% at the dark end through +40% at the light end.
    const t = steps === 1 ? 0 : (i / (steps - 1)) * 2 - 1;
    const f = 1 + t * 0.4;
    const c = (v: number) => clamp(Math.round(v * f), 0, 255);
    out.push(`#${((1 << 24) | (c(r) << 16) | (c(g) << 8) | c(b)).toString(16).slice(1)}`);
  }
  return out;
}

/**
 * A cool-shifted outline colour for `hex` — the "selout" trick the dungeon's
 * palette helpers use. A pure-black outline looks dead; darkening while pushing
 * slightly blue reads as shadow.
 */
export function inkFrom(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const c = (v: number, shift: number) => clamp(Math.round(v * 0.35 + shift), 0, 255);
  return `#${((1 << 24) | (c(r, 0) << 16) | (c(g, 2) << 8) | c(b, 10)).toString(16).slice(1)}`;
}
