/**
 * PIXEL CANVAS — draw at a small logical resolution, blit up at an integer
 * scale with smoothing off.
 *
 * This is the whole trick behind a pixel look in 2D. Everything else (chunky
 * fonts, hard-edge shapes, limited palettes) only reads as pixel art if the
 * final blit lands texels on whole device pixels. Two things break that:
 *
 *  - **Fractional scaling.** A devicePixelRatio of 1.5 or a "fit exactly to the
 *    viewport" scale smears every edge. Always scale by a whole number and let
 *    the result be letterboxed rather than filling the box exactly.
 *  - **Smoothing on the upscale.** `imageSmoothingEnabled` defaults to true, so
 *    the blit bilinearly interpolates the very pixels you were trying to show.
 *
 * Shared by the site room map (src/map) and the dungeon's floor map. Deliberately
 * standalone — the site map must not have to import the game to look like it.
 */

/** A low-res drawing surface plus the integer scale it blits to the screen at. */
export interface PixelSurface {
  /** The low-resolution canvas to draw into. Its ctx has smoothing OFF. */
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** Logical size, in pixel-art pixels. */
  readonly width: number;
  readonly height: number;
  /** Whole-number upscale factor currently in use. */
  readonly scale: number;
  /** Offset of the scaled image inside the target, for letterboxing (device px). */
  readonly offsetX: number;
  readonly offsetY: number;
  /**
   * Resize the logical surface to best fit `targetW × targetH` device pixels.
   * Returns true if anything changed (so a caller can skip a repaint).
   */
  fit(targetW: number, targetH: number): boolean;
  /** Blit the low-res surface onto `dest`, centred, at the integer scale. */
  blitTo(dest: CanvasRenderingContext2D, targetW: number, targetH: number): void;
  /** Map a point in destination (CSS/device) space back to logical pixels. */
  toLogical(x: number, y: number): { x: number; y: number };
}

export interface PixelSurfaceOptions {
  /**
   * Target logical width in pixel-art pixels. The surface picks the largest
   * integer scale that fits, then derives the logical height from the aspect.
   */
  logicalWidth: number;
  /** Never scale below this (a huge map on a small screen stays legible). */
  minScale?: number;
  /** Never scale above this, so a 4K display doesn't get absurd chunk sizes. */
  maxScale?: number;
}

/** The result of fitting a logical surface into a device-pixel box. */
export interface FitResult {
  scale: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Work out the logical size and integer scale for a target box.
 *
 * Pure and DOM-free so it can be tested directly — this is the maths that
 * decides whether the output reads as pixel art, so it's the part worth pinning
 * down. `createPixelSurface` is a thin canvas wrapper over it.
 */
export function computeFit(
  logicalWidth: number,
  targetW: number,
  targetH: number,
  minScale = 1,
  maxScale = 6,
): FitResult | null {
  if (targetW <= 0 || targetH <= 0) return null;

  // Largest WHOLE scale at which the logical width still fits.
  const raw = Math.floor(targetW / logicalWidth);
  const scale = Math.max(minScale, Math.min(maxScale, raw || 1));

  const width = Math.max(1, Math.round(logicalWidth));
  // Height follows from the space actually available at that scale, so the
  // surface fills the box rather than assuming a fixed aspect ratio.
  const height = Math.max(1, Math.floor(targetH / scale));

  return {
    scale,
    width,
    height,
    offsetX: Math.floor((targetW - width * scale) / 2),
    offsetY: Math.floor((targetH - height * scale) / 2),
  };
}

/**
 * Create a pixel drawing surface.
 *
 * Note it does NOT own a visible canvas — call `blitTo` with whatever context
 * you present. That keeps it usable both for a full-screen overlay and for a
 * small canvas parked inside a DOM HUD panel.
 */
export function createPixelSurface(opts: PixelSurfaceOptions): PixelSurface {
  const minScale = opts.minScale ?? 1;
  const maxScale = opts.maxScale ?? 6;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(opts.logicalWidth));
  canvas.height = 1;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  const surface = {
    canvas,
    ctx,
    width: canvas.width,
    height: canvas.height,
    scale: 1,
    offsetX: 0,
    offsetY: 0,

    fit(targetW: number, targetH: number): boolean {
      const f = computeFit(opts.logicalWidth, targetW, targetH, minScale, maxScale);
      if (!f) return false;

      const changed = surface.width !== f.width || surface.height !== f.height || surface.scale !== f.scale;

      // Offsets can shift without the logical size changing (a window resize
      // inside the same scale step), so always take them.
      surface.offsetX = f.offsetX;
      surface.offsetY = f.offsetY;
      if (!changed) return false;

      canvas.width = f.width;
      canvas.height = f.height;
      // Resizing a canvas resets its context state, smoothing included.
      ctx.imageSmoothingEnabled = false;

      surface.width = f.width;
      surface.height = f.height;
      surface.scale = f.scale;
      return true;
    },

    blitTo(dest: CanvasRenderingContext2D, targetW: number, targetH: number): void {
      dest.save();
      dest.imageSmoothingEnabled = false;
      dest.clearRect(0, 0, targetW, targetH);
      dest.drawImage(canvas, surface.offsetX, surface.offsetY, surface.width * surface.scale, surface.height * surface.scale);
      dest.restore();
    },

    toLogical(x: number, y: number): { x: number; y: number } {
      return {
        x: (x - surface.offsetX) / surface.scale,
        y: (y - surface.offsetY) / surface.scale,
      };
    },
  };

  return surface;
}

/**
 * Snap a value to the pixel grid. Sub-pixel coordinates are the single most
 * common way a "pixel" renderer gives itself away — a node at x=104.37 gets an
 * anti-aliased edge no matter how chunky everything else is.
 */
export function snap(v: number): number {
  return Math.round(v);
}

/**
 * Draw a 1px-stroke rectangle that lands ON the pixel grid.
 *
 * Canvas strokes straddle the path, so a 1px stroke at integer coordinates
 * covers half of two adjacent pixels and renders as a 2px blur. The half-pixel
 * offset is what makes it a crisp single line.
 */
export function strokeRectCrisp(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  lineWidth = 1,
): void {
  const off = (lineWidth % 2) / 2;
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(snap(x) + off, snap(y) + off, snap(w), snap(h));
}

/** Fill a rectangle snapped to whole pixels. */
export function fillRectCrisp(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillRect(snap(x), snap(y), snap(w), snap(h));
}

/**
 * A 2×2 checkerboard dither between two colours — the pixel-art stand-in for a
 * gradient or a translucent wash. `parity` shifts the pattern so adjacent
 * regions don't line up into visible seams.
 */
export function ditherRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  colorA: string,
  colorB: string,
  parity = 0,
): void {
  const x0 = snap(x);
  const y0 = snap(y);
  const x1 = x0 + snap(w);
  const y1 = y0 + snap(h);
  ctx.fillStyle = colorA;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  ctx.fillStyle = colorB;
  for (let py = y0; py < y1; py++) {
    for (let px = x0 + ((py + parity) & 1); px < x1; px += 2) {
      ctx.fillRect(px, py, 1, 1);
    }
  }
}
