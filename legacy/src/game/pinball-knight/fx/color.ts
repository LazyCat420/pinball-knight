/**
 * Palette → LINEAR colour, for anything that hands raw numbers to the GPU.
 *
 * WHY THIS IS ITS OWN FILE. The scene render target is LINEAR (see
 * engine/render/pixel-pass.ts), and three only auto-converts colours it owns —
 * `material.color`, a texture with a colour space. A literal written straight
 * into a vertex attribute or a TSL `vec3()` bypasses all of that and lands in
 * the buffer as-is. So every effect that names a colour numerically has to
 * convert by hand, and doing it in one place is the only way the fx/ tree and
 * the particle pools stay in agreement.
 *
 * `render/vfx.ts` (now `fx/system.ts`) had these two functions privately first; this module is the
 * shared home so a second copy never drifts from it.
 */
import { PALETTE_HEX } from "../render/palette";

/** sRGB transfer function, inverted. The exact curve, not the 2.2 approximation
 *  — the pixel pass's own linear→sRGB step uses the real one, and a mismatched
 *  pair shows up as effects that sit a shade off the world they light. */
export function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** sRGB hex → linear [r,g,b] in 0..1, for the linear scene buffer. */
export function linColor(hex: number): [number, number, number] {
  return [
    toLinear(((hex >> 16) & 0xff) / 255),
    toLinear(((hex >> 8) & 0xff) / 255),
    toLinear((hex & 0xff) / 255),
  ];
}

/**
 * Palette INDEX → linear [r,g,b].
 *
 * Effects name indices, never hex. That is not tidiness: the pixel pass snaps
 * every pixel to the nearest of the 32 palette entries by a LUMA-WEIGHTED
 * metric, so a free hex lands wherever that metric points — this repo has
 * already shipped a warm free-hex wash that measured 26.8% ROT GREEN. A colour
 * that is already a palette entry cannot be re-routed by the snap.
 */
export function palLin(index: number): [number, number, number] {
  const hex = PALETTE_HEX[index];
  if (hex === undefined) throw new Error(`palLin: no palette entry ${index}`);
  return linColor(hex);
}
