/**
 * What every pool in `fx/pools/` needs, and nothing else.
 *
 * These were private to the 1700-line `vfx.ts`. Splitting that file by effect
 * family meant either duplicating them into eight modules or naming them once —
 * and a duplicated `PARTICLE_SCALE` is the kind of constant that drifts silently
 * and shows up as one pool's particles being the wrong size on one camera zoom.
 */
import { PPU } from "../../constants";
import { linColor } from "../color";

/**
 * `aSize` is calibrated in RENDER-TARGET pixels — the units the old
 * `gl_PointSize` used — so it converts to world space by dividing by PPU.
 *
 * Load-bearing that this is derived from `PPU` and not written down: the camera
 * distance is a SETTING, so a hardcoded divisor would silently resize every
 * particle in the game the moment someone changed zoom.
 */
export const PARTICLE_SCALE = 1 / PPU;

/** Uniform random in [a, b). Every pool jitters something. */
export const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

// ── Linear palette picks, shared across pools ────────────────────────────────
// LINEAR because `sceneTarget` is a linear buffer — see `fx/color.ts` for why a
// literal written straight into a vertex attribute bypasses three's colour
// management entirely.
/** flame core — near white, blooms hard. */
export const C_SPARK = linColor(0xfff3c8);
/** flame light. */
export const C_SPARK2 = linColor(0xffd98a);
/** flame. */
export const C_EMBER = linColor(0xf0a63c);
/** rot green, three shades — the horde's blood. */
export const C_BLOOD_G = [linColor(0x5f8a4f), linColor(0x3d5c3a), linColor(0x8fc46b)];
/** blood red, three shades — the knight's, and the reaper's. */
export const C_BLOOD_R = [linColor(0xa83244), linColor(0x6b1f2a), linColor(0xd95763)];
/** stone light — floor dust. */
export const C_DUST = linColor(0x6b7688);
