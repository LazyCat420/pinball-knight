/**
 * Window pixels → UI pixels.
 *
 * The DOM overlays never needed this: a `position:fixed` div and the mouse
 * event that hit it were in the same coordinate system by construction. An
 * in-game UI is painted on the PIXEL-PASS GRID, which is a different space in
 * two ways at once — it is integer-downscaled from the window, and the canvas
 * is CENTRED in the window (letterboxed) whenever the scale does not divide the
 * window exactly. Both offsets have to come out, in that order.
 *
 * `resize()` in pixel-pass.ts is the other half of this contract. It sets
 *
 *   el.style.left = floor((winW - outW) / 2)
 *   el.style.top  = floor((winH - outH) / 2)
 *
 * and those two `floor`s are why this cannot be a plain divide: at an odd
 * letterbox the canvas sits half a pixel off centre, and a naive
 * `(x - (winW - outW) / 2)` is a pixel out along one edge. Mirror the floor.
 *
 * Kept pure and separate from layer.ts precisely so it can be tested without a
 * renderer — see coords.test.ts. A fault in here does not throw and does not
 * look like a coordinate bug: the menu simply stops responding near one edge,
 * or every click lands one row above the thing you aimed at.
 */

/** The subset of `RenderSizing` this needs. Structural, so the real one fits. */
export interface UiSizing {
  /** Integer window-pixels per UI pixel. */
  readonly scale: number;
  /** The UI grid, in UI pixels. */
  readonly renderW: number;
  readonly renderH: number;
  /** The canvas footprint in the window, in window pixels. */
  readonly outW: number;
  readonly outH: number;
}

export interface UiPoint {
  x: number;
  y: number;
  /** False when the point is outside the canvas (in a letterbox bar). */
  inside: boolean;
}

/**
 * Top-left of the canvas within the window, matching `resize()` exactly.
 *
 * Exported because the touch controls want the same origin and MUST NOT
 * re-derive it — two copies of this expression is precisely how the pointer and
 * the paint drift apart by a pixel and nobody can reproduce it.
 */
export function canvasOrigin(sizing: UiSizing, winW: number, winH: number): { left: number; top: number } {
  return {
    left: Math.floor((winW - sizing.outW) / 2),
    top: Math.floor((winH - sizing.outH) / 2),
  };
}

/**
 * Convert a window-space point (a MouseEvent's clientX/clientY) to UI pixels.
 *
 * Returns fractional UI pixels — the caller floors when it wants a texel. Hit
 * testing wants the fraction: a button spanning [8,16) must not swallow a click
 * at 16.0 just because both floor to the same row at scale 1.
 */
export function screenToUi(
  clientX: number,
  clientY: number,
  sizing: UiSizing,
  winW: number,
  winH: number,
): UiPoint {
  const { left, top } = canvasOrigin(sizing, winW, winH);
  const x = (clientX - left) / sizing.scale;
  const y = (clientY - top) / sizing.scale;
  return {
    x,
    y,
    inside: x >= 0 && y >= 0 && x < sizing.renderW && y < sizing.renderH,
  };
}
