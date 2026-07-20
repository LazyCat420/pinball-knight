/**
 * DARTBOARD PIXEL ART — rasterisers, the board bake, and the dart sprite.
 *
 * ── Why none of this uses arc() ─────────────────────────────────────────────
 * Same rule as `slots-game.ts`, and darts breaks it harder than any other game
 * would: Canvas 2D anti-aliases every path it draws and there is no flag to
 * turn that off, so an `arc()`-drawn dartboard arrives with soft grey fringes on
 * every one of its ~40 concentric edges. Next to the hand-authored reels it
 * reads as a blurry JPEG someone pasted into the cabinet. The previous darts
 * renderer drew the entire board — wedges, both scoring rings, both bulls —
 * out of `ctx.arc()` and `ctx.stroke()`, which is why it never matched.
 *
 * So the board is rasterised BY HAND, one pixel at a time, into an offscreen
 * canvas exactly once. Per-pixel is affordable precisely because it is baked:
 * ~22k pixels at startup, then a single integer `drawImage` blit per frame.
 *
 * ── The bake classifies pixels with scoreAt() ───────────────────────────────
 * The colour of every pixel on the board comes from asking `scoreAt` what that
 * pixel is worth. Not from a parallel table of ring radii — from the scoring
 * function itself. So the board you are looking at IS the scoring surface, and
 * the class of bug where the treble ring is drawn a pixel wider than it scores
 * (the player aims at green, hits green, and is paid for a single) is not
 * something that has to be tested for. It cannot be expressed.
 *
 * ── Colour ─────────────────────────────────────────────────────────────────
 * Every material is a three-tone ramp that is HUE-ROTATED rather than merely
 * lightened: shadows rotate cool (toward blue/violet), highlights rotate warm
 * (toward yellow/orange). A ramp picked on a lightness slider makes a coloured
 * object look like a grey object wearing a colour — the same note `slots-game`
 * records about its symbol ramps. Light comes from the top-left and is
 * quantised to those three steps, which is what gives a flat disc of pixels a
 * spherical read without a single gradient.
 */
import { scoreAt, WEDGES, WEDGE_COUNT, R_DOUBLE_IN, R_TREBLE_IN, R_TREBLE_OUT, R_OUTER_BULL } from "./darts";

// The canvas-factory seam lives in `offscreen.ts` now that roulette bakes its
// wheel the same way. Re-exported here so existing importers keep working.
import { domCanvasFactory, type CanvasFactory, type OffscreenLike } from "./offscreen";
export { domCanvasFactory };
export type { CanvasFactory, OffscreenLike };

/** How far past the rim the wooden surround and its number ring extend. */
export const SURROUND_OUT = 1.3;
const NUMBER_RING_R = 1.15;

/** shadow (cool) · base · highlight (warm). */
type Ramp = readonly [string, string, string];

// ── Ramps are deliberately TIGHT ────────────────────────────────────────────
// The first pass used a wide spread on every material and the render came back
// with a hard diagonal across the whole board: the cream wedges ran from grey
// in the top-left to near-white in the bottom-right, which swamped the
// black/cream alternation that makes the thing legible as a dartboard at all.
// The key light is a modulation, not a repaint — each ramp now spans about one
// shade either side of base, and the hue rotation (cool shadow, warm highlight)
// does the work that lightness range used to.
const WEDGE_DARK: Ramp = ["#100d15", "#171310", "#1e1913"];
const WEDGE_LITE: Ramp = ["#a08b6d", "#bda681", "#d3bd94"];
const RED: Ramp = ["#8e2b3c", "#a83039", "#bc4540"];
const GREEN: Ramp = ["#24684c", "#2f8a52", "#44a05a"];
const BULL_RED: Ramp = ["#a52a38", "#c0313c", "#d84b43"];
const BULL_GREEN: Ramp = ["#2a7a55", "#37a05e", "#52b866"];
// The surround frames the board, so it must sit UNDER it tonally. Previously it
// was the brightest thing on screen in the lit quadrant and read as a spotlight.
const SURROUND: Ramp = ["#191622", "#221d1e", "#2b2422"];
const WIRE: Ramp = ["#544b3e", "#6d6355", "#8a806e"];

/** Numbers on the surround ring. Warm bone, not white. */
const C_NUMBER = "#d9ccb2";
/** Behind everything, in the board's own hole. */
export const C_VOID = "#05070b";

/** 3×5 pixel digits. Anything smaller than this stops being legible. */
const DIGITS: readonly (readonly number[])[] = [
  [0b111, 0b101, 0b101, 0b101, 0b111], // 0
  [0b010, 0b110, 0b010, 0b010, 0b111], // 1
  [0b111, 0b001, 0b111, 0b100, 0b111], // 2
  [0b111, 0b001, 0b111, 0b001, 0b111], // 3
  [0b101, 0b101, 0b111, 0b001, 0b001], // 4
  [0b111, 0b100, 0b111, 0b001, 0b111], // 5
  [0b111, 0b100, 0b111, 0b101, 0b111], // 6
  [0b111, 0b001, 0b001, 0b010, 0b010], // 7
  [0b111, 0b101, 0b111, 0b101, 0b111], // 8
  [0b111, 0b101, 0b111, 0b001, 0b111], // 9
];

/**
 * Draw a number in 3×5 digits, left-aligned, 1px gap. Returns its width.
 *
 * `scale` must be a whole number and is applied by multiplying out the rects
 * rather than by `ctx.scale`, which would put the glyphs on a transformed grid
 * and reintroduce half-pixel edges the moment anything else moved.
 */
export function drawNumber(
  ctx: CanvasRenderingContext2D,
  n: number,
  x: number,
  y: number,
  colour: string,
  scale = 1,
): number {
  const s = String(Math.max(0, Math.floor(n)));
  const k = Math.max(1, Math.round(scale));
  ctx.fillStyle = colour;
  for (let d = 0; d < s.length; d++) {
    const glyph = DIGITS[s.charCodeAt(d) - 48];
    if (!glyph) continue;
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        if (glyph[row] & (1 << (2 - col))) {
          ctx.fillRect(Math.round(x) + (d * 4 + col) * k, Math.round(y) + row * k, k, k);
        }
      }
    }
  }
  return numberWidth(n, k);
}

export function numberWidth(n: number, scale = 1): number {
  const k = Math.max(1, Math.round(scale));
  return (String(Math.max(0, Math.floor(n))).length * 4 - 1) * k;
}

/**
 * Pick a tone off a ramp for a surface normal under a top-left key light.
 *
 * Three steps, hard edges. A continuous term here would band anyway on an
 * 8-bit surface and would cost the crispness the whole file exists to protect.
 */
function shade(ramp: Ramp, nx: number, ny: number): string {
  const lit = (-nx - ny) * 0.7071;
  // Wide dead band: most of the board sits on `base`, and only the two far
  // corners pick up the rim tones. A narrower band turns the light into a
  // diagonal stripe across the middle of the board.
  if (lit > 0.58) return ramp[2];
  if (lit < -0.58) return ramp[0];
  return ramp[1];
}

/** Angular half-width of a wedge, in radians. */
const WEDGE_HALF = Math.PI / WEDGE_COUNT;

/** Radii that carry a wire. Everything the eye reads as "the spider". */
const WIRE_RINGS = [R_OUTER_BULL, R_TREBLE_IN, R_TREBLE_OUT, R_DOUBLE_IN, 1.0];

/**
 * Bake the board. `R` is the board radius in pixels; the returned canvas is
 * square with the board centred, and is `SURROUND_OUT * R` bigger all round.
 */
export function buildBoard(R: number, factory: CanvasFactory = domCanvasFactory): OffscreenLike {
  const pad = Math.ceil(R * SURROUND_OUT);
  const size = pad * 2 + 1;
  const cv = factory(size, size);
  const ctx = cv.getContext("2d") as CanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = false;

  // One wire is ~1.1px wide however big the board is — a wire that scales with
  // the board turns into a fat black cross at large sizes.
  const wireHalf = 0.55 / R;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const nx = (px - pad + 0.5) / R;
      const ny = (py - pad + 0.5) / R;
      const r = Math.hypot(nx, ny);
      if (r > SURROUND_OUT) continue;

      // ── The wooden surround, outside the playing area ──
      if (r > 1) {
        ctx.fillStyle = shade(SURROUND, nx / SURROUND_OUT, ny / SURROUND_OUT);
        ctx.fillRect(px, py, 1, 1);
        continue;
      }

      // ── Wire, tested before the material so it sits ON TOP ──
      let wire = false;
      for (const ring of WIRE_RINGS) {
        if (Math.abs(r - ring) < wireHalf) {
          wire = true;
          break;
        }
      }
      if (!wire && r > R_OUTER_BULL) {
        // Angular distance to the nearest wedge boundary, as an arc length so
        // the spokes stay one pixel wide all the way out instead of fanning.
        const ang = Math.atan2(nx, -ny);
        const off = ((ang % (2 * WEDGE_HALF)) + 3 * WEDGE_HALF) % (2 * WEDGE_HALF) - WEDGE_HALF;
        if (Math.abs(off) * r < wireHalf) wire = true;
      }
      if (wire) {
        ctx.fillStyle = shade(WIRE, nx, ny);
        ctx.fillRect(px, py, 1, 1);
        continue;
      }

      // ── Material, straight out of the scoring function ──
      const hit = scoreAt(nx, ny);
      const idx = WEDGES.indexOf(hit.wedge);
      const dark = idx >= 0 && idx % 2 === 0;
      let ramp: Ramp;
      if (hit.ring === "bull") ramp = BULL_RED;
      else if (hit.ring === "outer-bull") ramp = BULL_GREEN;
      else if (hit.ring === "double" || hit.ring === "treble") ramp = dark ? RED : GREEN;
      else ramp = dark ? WEDGE_DARK : WEDGE_LITE;

      ctx.fillStyle = shade(ramp, nx, ny);
      ctx.fillRect(px, py, 1, 1);
    }
  }

  // ── Numbers on the surround ── centred on each wedge, upright, never rotated:
  // rotated 3×5 glyphs are unreadable and would have to be drawn with a
  // transform, which re-introduces the anti-aliasing this file avoids.
  for (let i = 0; i < WEDGE_COUNT; i++) {
    const a = (i / WEDGE_COUNT) * Math.PI * 2;
    const cx = pad + Math.sin(a) * R * NUMBER_RING_R;
    const cy = pad - Math.cos(a) * R * NUMBER_RING_R;
    const v = WEDGES[i];
    drawNumber(ctx, v, Math.round(cx - numberWidth(v) / 2), Math.round(cy - 2), C_NUMBER);
  }

  return cv;
}

/**
 * Did this landing clip a wire? Cosmetic only — it changes the THUD, not the
 * score, and it reads off the same WIRE_RINGS the bake draws, so a dart that
 * pings never turns out to be sitting in clean sisal.
 *
 * `R` is the on-screen board radius, because "within a wire's width" is a
 * pixel-space question: the wire is always ~1px however big the board is.
 */
export function hitWire(x: number, y: number, R: number): boolean {
  const r = Math.hypot(x, y);
  if (r > 1) return false;
  const wireHalf = 0.9 / Math.max(1, R);
  for (const ring of WIRE_RINGS) {
    if (Math.abs(r - ring) < wireHalf) return true;
  }
  if (r <= R_OUTER_BULL) return false;
  const ang = Math.atan2(x, -y);
  const off = ((ang % (2 * WEDGE_HALF)) + 3 * WEDGE_HALF) % (2 * WEDGE_HALF) - WEDGE_HALF;
  return Math.abs(off) * r < wireHalf;
}

/** ── The dart sprite ──────────────────────────────────────────────────────── */

const C_DART_SHADOW = "#07090f";
const C_BARREL: Ramp = ["#7a6320", "#c39a2e", "#efd06a"];
const C_TIP = "#cfd8e6";
const C_FLIGHT_A = "#c33b46";
const C_FLIGHT_B = "#e8dcc0";

/** Integer-stepped line of square caps. Bresenham, so it never fringes. */
function plot(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, w: number, colour: string): void {
  ctx.fillStyle = colour;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  const o = Math.floor(w / 2);
  for (let guard = 0; guard < 512; guard++) {
    ctx.fillRect(x - o, y - o, w, w);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

/**
 * The angle a dart sits at once stuck, in radians, measured from +x with y down.
 *
 * Points up and to the RIGHT because that is where the thrower is standing —
 * the readout panel is on the right of the cabinet, so the fiction is that the
 * knight is off that edge. Every dart leaning the same way is what makes a
 * board full of them read as thrown rather than placed.
 */
const DART_BASE_ANGLE = (-33 * Math.PI) / 180;

/**
 * Draw a dart stuck in the board, tip at (x, y).
 *
 * `scale` shrinks the whole sprite for the in-flight dart, which reads as the
 * dart being further away — the only depth cue available without perspective.
 */
export function drawDart(ctx: CanvasRenderingContext2D, x: number, y: number, leanDeg: number, scale = 1): void {
  const a = DART_BASE_ANGLE + (leanDeg * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const len = Math.max(4, Math.round(13 * scale));
  const at = (d: number): [number, number] => [Math.round(x + ca * d), Math.round(y + sa * d)];

  // ── Cast shadow ── offset down-right, drawn first and never alpha-blended.
  const [sx0, sy0] = at(1);
  const [sx1, sy1] = at(len);
  plot(ctx, sx0 + 2, sy0 + 3, sx1 + 2, sy1 + 3, scale > 0.7 ? 2 : 1, C_DART_SHADOW);

  // ── Barrel ── the thick middle, lit on its upper edge.
  const [bx0, by0] = at(2);
  const [bx1, by1] = at(Math.round(len * 0.62));
  plot(ctx, bx0, by0, bx1, by1, scale > 0.7 ? 3 : 2, C_BARREL[1]);
  plot(ctx, bx0, by0 - 1, bx1, by1 - 1, 1, C_BARREL[2]);

  // ── Flight ── two flat tones, offset perpendicular to the shaft.
  if (scale > 0.55) {
    const [fx0, fy0] = at(Math.round(len * 0.66));
    const [fx1, fy1] = at(len);
    const px = Math.round(-sa * 2);
    const py = Math.round(ca * 2);
    plot(ctx, fx0, fy0, fx1, fy1, 2, C_FLIGHT_A);
    plot(ctx, fx0 + px, fy0 + py, fx1 + px, fy1 + py, 1, C_FLIGHT_B);
    plot(ctx, fx0 - px, fy0 - py, fx1 - px, fy1 - py, 1, C_FLIGHT_B);
  }

  // ── Point ── one bright pixel exactly where the score was taken, so the
  // sprite can never imply the dart is somewhere other than where it scored.
  ctx.fillStyle = C_TIP;
  ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
  ctx.fillRect(Math.round(x + ca), Math.round(y + sa), 1, 1);
}

/** ── Small shared chrome, matching the slots cabinet's box()/frame() ──────── */

export function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, colour: string): void {
  ctx.fillStyle = colour;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** A 1px hard border. Four fillRects — strokeRect half-pixels and fringes. */
export function frame(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, colour: string): void {
  const X = Math.round(x);
  const Y = Math.round(y);
  const W = Math.round(w);
  const H = Math.round(h);
  ctx.fillStyle = colour;
  ctx.fillRect(X, Y, W, 1);
  ctx.fillRect(X, Y + H - 1, W, 1);
  ctx.fillRect(X, Y, 1, H);
  ctx.fillRect(X + W - 1, Y, 1, H);
}
