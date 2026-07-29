/**
 * THE UI LAYER — one canvas, uploaded once a frame, composited inside the
 * pixel pass.
 *
 * This is the surface every screen in the game paints into. It is a canvas
 * element that is NEVER appended to the document: it is a backing store for a
 * `CanvasTexture`, not an overlay. That distinction is the whole point of the
 * migration — nothing about this layer is reachable from the page, it cannot
 * catch a stray click, and it lives and dies inside the render pipeline.
 *
 * ── SIZE ──
 * The canvas is exactly `sizing.renderW × renderH` — the pixel pass's LOGICAL
 * grid, not the window. So one UI pixel is one render-target texel is (after
 * the integer upscale) `scale` window pixels. Painting a 1px line here yields a
 * genuinely 1-texel line on screen at any window size, which is the only way
 * the UI can share the art's pixel grid.
 *
 * ── COLOUR ──
 * `colorSpace = LinearSRGBColorSpace` is load-bearing and means "do NOT decode
 * this". Canvas2D authors in sRGB, and the pass composites the UI AFTER its
 * hand-written linear→sRGB transfer, so `col` and the UI texel are already in
 * the same space. Letting three decode it to linear would wash the entire UI
 * out — and it would look like a CSS/palette problem, not a colour-space one.
 * The same trap is documented at the top of pixel-pass.ts for the renderer's
 * own output encode; this is that trap's twin.
 *
 * ── ALPHA ──
 * Straight (non-premultiplied), so the composite is a plain
 * `mix(col, ui.rgb, ui.a)`. The UI paints on an 8px grid with antialiasing off,
 * so alpha is very nearly always 0 or 1 and the choice costs nothing; it is
 * pinned explicitly anyway because the default flipping would silently darken
 * every soft edge we do draw (scrim, glows).
 */
import * as THREE from "three";
import { awaitPixelFonts, ensurePixelFonts } from "../pixel-fonts";
import type { UiSizing } from "./coords";

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let tex: THREE.CanvasTexture | null = null;

/** True once the pixel fonts are usable by canvas — see `fontsReady()`. */
let fontsReady = false;

/**
 * Nothing has been drawn since the last upload.
 *
 * The upload is the expensive half of this layer (a full-grid texture write
 * every frame at up to 1920x1080), and the UI is static most of the time it is
 * open — a paused menu repaints only when a key is pressed. So `commit()`
 * uploads only when a screen actually painted.
 */
let dirty = false;

/**
 * True while any screen wants the layer composited at all.
 *
 * When nothing is open the layer is fully transparent and the composite is a
 * wasted texture fetch per pixel. The pass reads this through `uiActive()` and
 * pokes a uniform to zero, which keeps the branch out of the shader.
 */
let active = false;

/** Allocate on first use. The canvas is deliberately never parented. */
function ensureCanvas(): HTMLCanvasElement {
  if (canvas) return canvas;
  canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  ctx = canvas.getContext("2d", { alpha: true });
  if (ctx) ctx.imageSmoothingEnabled = false;
  ensurePixelFonts();
  void awaitPixelFonts().then(() => {
    fontsReady = true;
    dirty = true; // repaint whatever is open with the real faces
  });
  return canvas;
}

/**
 * The texture handed to `createPixelPass`.
 *
 * Created ONCE and never replaced. A TSL node graph binds its texture at build
 * time (pixel-pass.ts says so twice), so swapping this object out on resize
 * would leave the shader sampling a dead texture — the UI would simply stop
 * updating, with no error. Resizes go through `syncSize()`, which reallocates
 * the canvas behind the same texture object.
 */
export function uiTexture(): THREE.CanvasTexture {
  if (tex) return tex;
  tex = new THREE.CanvasTexture(ensureCanvas());
  tex.colorSpace = THREE.LinearSRGBColorSpace; // see COLOUR above — not decoded
  tex.premultiplyAlpha = false; // see ALPHA above
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  // flipY stays at three's DEFAULT (true). The retraction note in this repo is
  // explicit: every `flipY = false` edit made to "fix" orientation was wrong,
  // and the real seam was the pass's UV. The pass samples this texture through
  // the same `rtUv()` as its other inputs so the UI shares one convention with
  // the frame it lands on; if orientation is ever in question, judge it with an
  // ASYMMETRIC marker (see `paintOrientationProbe`), never with a menu, because
  // a centred sheet looks identical either way up.
  return tex;
}

/** Whether the pixel fonts have loaded. Screens paint fallbacks until they do. */
export function fontsAreReady(): boolean {
  return fontsReady;
}

/**
 * Match the canvas to the pass's current grid. Cheap and idempotent.
 *
 * ── DO NOT `dispose()` THE TEXTURE HERE ──
 * The obvious move is `tex.dispose()`, mirroring what `pixel-pass.resize()`
 * does to its render targets. It is wrong, and it fails in the most expensive
 * way available: SILENTLY and TOTALLY.
 *
 * A render target's `setSize()` reallocates while keeping the same texture
 * object, so bindings stay valid. `Texture.dispose()` is a different thing — it
 * tears down the backend resource, and under the node renderer the material's
 * bind group still references the destroyed GPU texture. Sampling it yields
 * zeroes, so `uiTexel.a` is 0, so `mix(col, ui.rgb, 0)` is the identity and the
 * UI composites to nothing. Every counter says the UI painted (it did — the
 * canvas was perfect), the screen shows no UI, and nothing anywhere errors.
 * Measured 2026-07-28: `__gui()` reported `painted: 210` while the layer dump
 * showed a correct image and the frame showed none of it.
 *
 * `needsUpdate` is the correct signal. three re-uploads the canvas and
 * reallocates the backing GPU texture when its dimensions change, without ever
 * invalidating the object the node graph bound at build time.
 */
export function syncSize(sizing: UiSizing): void {
  const c = ensureCanvas();
  if (c.width === sizing.renderW && c.height === sizing.renderH) return;
  c.width = sizing.renderW;
  c.height = sizing.renderH;
  // Resetting the backing store clears it AND resets context state (transform,
  // smoothing, font). Re-pin what we rely on.
  if (ctx) ctx.imageSmoothingEnabled = false;
  if (tex) tex.needsUpdate = true;
  dirty = true;
}

/** The 2D context every screen paints through. Null only before first use. */
export function uiCtx(): CanvasRenderingContext2D | null {
  ensureCanvas();
  return ctx;
}

/** The UI grid size, in UI pixels. */
export function uiSize(): { w: number; h: number } {
  const c = ensureCanvas();
  return { w: c.width, h: c.height };
}

/** Clear the layer and start a frame's painting. */
export function beginFrame(): CanvasRenderingContext2D | null {
  const c = ensureCanvas();
  if (!ctx) return null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  return ctx;
}

/** Mark the layer as needing an upload. Screens call this when they paint. */
export function markDirty(): void {
  dirty = true;
}

/** Whether anything is currently drawn — drives the composite uniform. */
export function uiActive(): boolean {
  return active;
}

export function setUiActive(on: boolean): void {
  if (active === on) return;
  active = on;
  dirty = true;
}

/**
 * Upload the canvas if it changed. Call once per frame, BEFORE the pass runs.
 * Returns whether an upload happened (the profiler wants to know).
 */
export function commit(): boolean {
  if (!dirty || !tex) return false;
  tex.needsUpdate = true;
  dirty = false;
  return true;
}

/**
 * An ASYMMETRIC probe for judging orientation, per the flipY lesson.
 *
 * Paints a filled block in the TOP-LEFT eighth of the grid and a thin bar down
 * the LEFT edge. If what you see on screen is bottom-left, the composite is
 * v-flipped; if it is top-right, it is u-flipped. A symmetric menu can be
 * upside down and look perfect, which is precisely how this repo shipped two
 * non-fixes for the same bug.
 *
 * Driven from the console: `__gui.probe()`.
 */
export function paintOrientationProbe(): void {
  const c = ensureCanvas();
  const g = beginFrame();
  if (!g) return;
  g.fillStyle = "rgba(0,0,0,0.6)";
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#f0a63c";
  g.fillRect(0, 0, Math.floor(c.width / 8), Math.floor(c.height / 8));
  g.fillStyle = "#6fd0e8";
  g.fillRect(0, 0, 4, c.height);
  setUiActive(true);
  markDirty();
}

/** Drop everything. Called from the game's dispose path. */
export function disposeUiLayer(): void {
  tex?.dispose();
  tex = null;
  ctx = null;
  canvas = null;
  dirty = false;
  active = false;
}
