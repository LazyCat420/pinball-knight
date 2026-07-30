/**
 * FAMILY CROSSING — how often does the scene's own lighting change a pixel's
 * MATERIAL before the palette snap gets to choose one?
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 *
 * `MAZE_COLOUR_PLAN.md` asked the right question — "what fraction of environment
 * pixels land in a family their albedo does not belong to?" — and pointed at the
 * wrong instrument. `scripts/biome-ab.mjs --census` reports the SHARE of each
 * family in a frame. A share cannot tell you a pixel is in the WRONG family: you
 * would need that pixel's albedo, and a screenshot has thrown it away.
 *
 * But the crossing rate does not need a screenshot at all. The snap is a pure
 * function of (albedo, light), and both are constants in this repo: the palette
 * is `palette.ts`, the biome tints are `boot/biomes.ts`, the intensities are
 * `constants/render.ts`. So the whole question is arithmetic, and it is answered
 * here — exactly, deterministically, in the suite, with no GPU.
 *
 * ── WHAT IT MEASURED (2026-07-30) ────────────────────────────────────────────
 *
 * Over 4 biomes x 48 shading situations x 30 material entries:
 *
 *   snap on the LIT colour (what shipped)          51.5% cross family
 *   ...with a desaturated torch                    48.9%
 *   ...with a white torch                          46.5%
 *   ...with ambient pushed from 3.5 to 6.0         47.9%
 *   snap on chromaticity (luma-normalised)         31.7%
 *   snap on the ALBEDO                              0.0%   by construction
 *
 * Two findings, and both redirected the wave:
 *
 * 1. **The cheap fixes are worth nothing.** The plan offered "desaturate the
 *    torch" and "move the bloom" as things to try before the render-graph
 *    surgery. They move a 51.5% defect by 3-5 points. The hue rotation everyone
 *    could see is not the mechanism.
 *
 * 2. **The mechanism is the DARKENING, not the hue.** With ambient at 3.5 the
 *    rig multiplies linear albedo by about [0.34, 0.47, 0.70] on an ordinary
 *    open floor — the scene is rendered at roughly 40% of its own albedo before
 *    anything is snapped. `palette-shading.ts`'s header already measured what a
 *    scalar multiply does to this palette (entry 28 changes hue at FIVE percent
 *    shadow); nobody had connected that table to the scene lighting being a 0.4x
 *    multiply. It is the same defect, arriving from the dominant term.
 *
 * That is why the shipped fix is an albedo target and not a lighting tweak: any
 * pre-snap multiply crosses families here, and geometric shading IS a pre-snap
 * multiply. There was no cheaper thing to try.
 *
 * ── THE MODEL, AND WHAT IT IS ALLOWED TO BE WRONG ABOUT ──────────────────────
 *
 * `lightMultiplier` reproduces three's Lambert path: irradiance is the sum of
 * `color * intensity` over the lights, and `BRDF_Lambert` divides by PI. It
 * ignores normal maps, shadow maps, roughness and the specular lobe. Every one
 * of those ADDS variation to the multiplier, so they can only raise the crossing
 * rate — the model is a floor, not an estimate, which is the safe direction for
 * a number used to justify work.
 *
 * The conclusion is also insensitive to the one constant worth doubting: re-run
 * without the 1/PI and the shipped path measures 42% against the albedo path's
 * 0%, with the cheap fixes still worthless. Nothing here rests on getting three's
 * normalisation exactly right.
 *
 * NEGATIVE CONTROL: a rig whose multiplier is exactly 1 must cross zero
 * families, for every snap mode. `light-crossing.test.ts` asserts it. The first
 * version of this model reported 59.6% for its "no lighting" case — because
 * "ambient intensity 0" still left the hemisphere and key lights on. The control
 * caught it; without one, that 59.6% would have been written down as a finding.
 */
import { PALETTE_HEX } from "./palette";
import { familyOf } from "./palette-shading";

/** sRGB transfer, both directions — the same pair `pixel-pass.ts` applies by hand. */
export const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const linearToSrgb = (c: number): number =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055;

export type RGB = readonly [number, number, number];

const hexSrgb = (h: number): RGB => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const hexLinear = (h: number): RGB => hexSrgb(h).map(srgbToLinear) as unknown as RGB;

/** The quantizer's luma weights. Must stay identical to `pixel-pass.ts`. */
export const LUMA_W: RGB = [0.3, 0.59, 0.11];
const luma = (c: RGB): number => c[0] * LUMA_W[0] + c[1] * LUMA_W[1] + c[2] * LUMA_W[2];

const PALETTE_SRGB: RGB[] = PALETTE_HEX.map(hexSrgb);

/**
 * The pixel pass's snap, in plain node: nearest palette entry under a
 * weighted-euclidean metric with the luma weights applied PER CHANNEL.
 *
 * Deliberately written the same way the shader writes it — `(a-b)*w` rather than
 * `a*w - b*w` — because those round differently and flip the winner on 12 of the
 * 496 exact midpoints (see `palette-snap.test.ts`).
 */
export function snapToPalette(srgb: RGB): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < PALETTE_SRGB.length; i++) {
    const p = PALETTE_SRGB[i];
    let d = 0;
    for (let k = 0; k < 3; k++) {
      const v = (srgb[k] - p[k]) * LUMA_W[k];
      d += v * v;
    }
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** The rig, as the light constants describe it. Colours are sRGB hex. */
export interface Rig {
  ambientHex: number;
  ambientIntensity: number;
  skyHex: number;
  groundHex: number;
  hemiIntensity: number;
  dirHex: number;
  dirIntensity: number;
  torchHex: number;
  torchIntensity: number;
}

/** One shading situation: how the surface happens to face the lights. */
export interface Situation {
  /** N·L against the key light, 0-1. */
  ndotl: number;
  /** How far up the surface faces, 0-1 — the hemisphere light's blend. */
  up: number;
  /** Torch contribution after distance falloff, 0-1. */
  torch: number;
}

/**
 * The factor the rig multiplies LINEAR albedo by, per channel.
 *
 * Irradiance summed over the lights, then through `BRDF_Lambert` (the 1/PI).
 * A value near 1 means the frame renders at its own albedo; the measured
 * open-floor value is about 0.4, which is the whole finding.
 */
export function lightMultiplier(rig: Rig, s: Situation): RGB {
  const amb = hexLinear(rig.ambientHex);
  const sky = hexLinear(rig.skyHex);
  const gnd = hexLinear(rig.groundHex);
  const dir = hexLinear(rig.dirHex);
  const tor = hexLinear(rig.torchHex);
  const out: number[] = [];
  for (let k = 0; k < 3; k++) {
    const irradiance =
      amb[k] * rig.ambientIntensity +
      sky[k] * rig.hemiIntensity * s.up +
      gnd[k] * rig.hemiIntensity * (1 - s.up) +
      dir[k] * rig.dirIntensity * s.ndotl +
      tor[k] * rig.torchIntensity * s.torch * s.ndotl;
    out.push(irradiance / Math.PI);
  }
  return out as unknown as RGB;
}

/** The lit sRGB colour a material of `albedoIdx` presents under `mul`. */
export function litColour(albedoIdx: number, mul: RGB): RGB {
  const a = hexLinear(PALETTE_HEX[albedoIdx]);
  return [0, 1, 2].map((k) => Math.min(1, linearToSrgb(a[k] * mul[k]))) as unknown as RGB;
}

/**
 * The sweep of shading situations the rate is measured over.
 *
 * A spread rather than one hand-picked point: a single "typical" surface is how
 * you measure your own assumption. 4 x 3 x 4 = 48 situations, from a wall facing
 * away from the key light in torchlight to a floor facing straight up with none.
 */
export const SITUATIONS: readonly Situation[] = (() => {
  const out: Situation[] = [];
  for (const ndotl of [0.15, 0.4, 0.7, 1.0]) {
    for (const up of [0.15, 0.5, 0.85]) {
      for (const torch of [0, 0.15, 0.4, 1.0]) out.push({ ndotl, up, torch });
    }
  }
  return out;
})();

export interface CrossingReport {
  /** Percent of (material x situation) pairs whose family changed. */
  rate: number;
  crossings: number;
  total: number;
  /** `"stone→steel"` → count, worst first. */
  worst: [string, number][];
}

const FAMILY_NAME = ["stone", "rot", "blood", "torch", "steel", "skin", "leather", "arcane"];

/**
 * How often the snap picks a different FAMILY than the material's own.
 *
 * `snapOn: "albedo"` is the shipped path since the albedo target landed and is 0
 * by construction — it is kept as the positive control, so the harness proves it
 * can report zero. `snapOn: "lit"` is the defect this file exists to size, kept
 * as the NEGATIVE control so the invariant cannot quietly become unfalsifiable
 * (the same reason `palette-install.test.ts` still carries the `i-1` chain).
 *
 * Ink (1) and void (0) are excluded: they are the terminator every family falls
 * through to, not materials anyone authors.
 */
export function familyCrossing(rigs: readonly Rig[], snapOn: "lit" | "albedo"): CrossingReport {
  let crossings = 0;
  let total = 0;
  const worst = new Map<string, number>();
  for (const rig of rigs) {
    for (const s of SITUATIONS) {
      const mul = lightMultiplier(rig, s);
      for (let i = 2; i < PALETTE_HEX.length; i++) {
        const chosen = snapOn === "albedo" ? snapToPalette(hexSrgb(PALETTE_HEX[i])) : snapToPalette(litColour(i, mul));
        total++;
        if (familyOf(chosen) !== familyOf(i)) {
          crossings++;
          const key = `${FAMILY_NAME[familyOf(i)]}→${FAMILY_NAME[familyOf(chosen)]}`;
          worst.set(key, (worst.get(key) ?? 0) + 1);
        }
      }
    }
  }
  return {
    rate: total ? (100 * crossings) / total : 0,
    crossings,
    total,
    worst: [...worst.entries()].sort((a, b) => b[1] - a[1]),
  };
}

/**
 * How bright the frame is relative to its own albedo — `luma(lit) / luma(albedo)`
 * averaged over the sweep.
 *
 * This is the number that says how many rows the shaded palette has to walk, and
 * in WHICH direction. Measured: about 0.45 on an open floor (walk DOWN two or
 * three rungs) but ABOVE 1 next to a torch — which is why the shaded palette
 * needed rows going UP as well. A downward-only table would have clamped every
 * torch-lit surface at row 0 and thrown the torchlight away.
 */
export function brightnessRange(rigs: readonly Rig[]): { min: number; max: number; mean: number } {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let n = 0;
  for (const rig of rigs) {
    for (const s of SITUATIONS) {
      const mul = lightMultiplier(rig, s);
      for (let i = 2; i < PALETTE_HEX.length; i++) {
        const a = hexSrgb(PALETTE_HEX[i]);
        const la = luma(a);
        if (la < 0.02) continue; // ratio is meaningless against a near-black albedo
        const r = luma(litColour(i, mul)) / la;
        min = Math.min(min, r);
        max = Math.max(max, r);
        sum += r;
        n++;
      }
    }
  }
  return { min, max, mean: n ? sum / n : 0 };
}
