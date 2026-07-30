/**
 * FIRE — a domain-warped fractal-noise field, thresholded into flame tongues.
 *
 * ── WHAT WAS WRONG BEFORE ────────────────────────────────────────────────────
 * A fire puddle was ten overlapping orange circles under a five-stop radial
 * gradient, painted once into a 128px canvas, and animated by scaling the quad
 * with `1 + sin(age*13)*0.12`. Every frame showed the SAME SHAPE at a slightly
 * different size. Fire does the opposite: it holds roughly the same size and
 * changes shape constantly. No amount of pulsing fixes a still image.
 *
 * ── THE THREE TERMS THAT DO THE WORK ─────────────────────────────────────────
 *
 * 1. **DOMAIN WARP** (`warp`). Scrolling a noise field through time makes it
 *    throb in place. Warping the sample point by a second, slower noise field
 *    makes features curl and shear past each other. This is the difference
 *    between "a texture pulsing" and "something burning".
 *
 * 2. **DIRECTIONAL ADVECTION.** Flame has a direction — up, or out from the
 *    source. The noise is sampled with one axis marching against time, so
 *    features are born at the hot end and die at the cool end. Which axis
 *    depends on how the quad is hung, hence `orientation`:
 *      · "floor"     — a puddle seen from above. Travel is RADIALLY OUTWARD, so
 *                      the fire looks like it is spreading from its core.
 *      · "billboard" — a torch, a vent, a brazier bead. Travel is UP the quad.
 *    Getting this wrong is not subtle: an upward-advected puddle reads as a
 *    smear sliding off one edge.
 *
 * 3. **THRESHOLDED ALPHA — the silhouette comes from the NOISE, not the disc.**
 *    This is the single biggest believability win in the file. If alpha is a
 *    radial falloff you get a soft blob with fire-coloured texture inside it.
 *    Threshold the noise field instead and the OUTLINE itself becomes ragged and
 *    mobile: tongues detach, gaps open, the edge licks. `discMask` only keeps the
 *    field from running off the quad; it is not the shape.
 *
 * ── COLOUR: FIVE BANDS OF THE TORCH RAMP ─────────────────────────────────────
 * 14 ember → 15 flame dark → 16 flame → 17 flame light → 18 flame core, hottest
 * in the middle. Palette entries only, for the reason in `noise.ts`'s header.
 * 17 and 18 sit above the pass's `BLOOM_THRESHOLD` (0.7 luma), so the hot core
 * still feeds the bloom exactly as the old white gradient centre did — the halo
 * around a fire is not lost in this change.
 */
import { float, length, saturate, smoothstep, uniform, vec3, vec4 } from "three/tsl";
import { bandRamp, discMask, discP, fbm01, warp, type TSLNode } from "./noise";
import { elementMaterial, type ElementMaterial } from "./element";

/** Dark → hot. The whole torch ramp, which is the only warmth in this palette. */
export const FIRE_RAMP = [14, 15, 16, 17, 18] as const;

/**
 * Where the bands change. Tuned so the flame is mostly ORANGE with a small
 * white core.
 *
 * Equal-width bands put 18 (flame core, near-white) on a fifth of the field, and
 * with additive blending plus bloom on top that renders as a white smear with
 * orange debris around it — which is what the first version looked like. Pushing
 * 17 and 18 up to 0.74/0.90 keeps the near-whites for the genuinely hottest
 * pixels, so the bloom halo comes off a core instead of off the whole pool.
 */
const FIRE_STOPS = [0.26, 0.50, 0.74, 0.90] as const;

export interface FireOpts {
  /** How the quad is hung. See term 2 in the header — this is not cosmetic. */
  orientation?: "floor" | "billboard";
  /**
   * Noise level below which the pixel is empty. Higher = sparser, more
   * separated tongues; lower = a fuller body of flame. 0.42 reads as a healthy
   * pool; a guttering trail tile wants ~0.5.
   */
  cutoff?: number;
  /** Feature size. Bigger = finer detail, which at 72 px/unit turns to fizz
   *  fast — the value here is tuned to leave features ~4+ texels wide. */
  scale?: number;
}

export function createFireMaterial(opts: FireOpts = {}): ElementMaterial {
  // `scale` 3.0 was too fine: at 72 render pixels per world unit a feature that
  // small survives the palette snap as confetti, and the pool read as scattered
  // embers rather than as one burning thing. 2.0 keeps features wide enough to
  // hold an interior. `cutoff` came down with it so the body stays CONNECTED —
  // tongues should detach from a mass, not float on their own.
  const { orientation = "floor", cutoff = 0.16, scale = 2.0 } = opts;

  const uTime = uniform(0);
  const uOpacity = uniform(1);
  const uIntensity = uniform(1);
  const uSeed = uniform(0);

  const material = elementMaterial(true); // fire ADDS light

  const p = discP();
  const r = length(p);
  const t = uTime.add(uSeed);

  // Warp first, then advect. Warping the ALREADY-advected point would drag the
  // warp along with the flow and cancel most of the curl.
  const wp = warp(p, t);

  const sample: TSLNode = orientation === "floor"
    // Radially outward: the phase term is the radius, marching against time, so
    // rings of flame are born at the core and travel to the rim.
    ? vec3(wp.mul(scale), r.mul(2.0).sub(t.mul(1.6)))
    // Upward: y marches against time. The z term is a slow evolve so the flame
    // is not a strictly vertical scroll (which reads as a conveyor belt).
    : vec3(wp.x.mul(scale), wp.y.mul(scale).sub(t.mul(1.9)), t.mul(0.35));

  const n = fbm01(sample, 4);

  // The heat field. `sub(r * 0.55)` is a radial bias — without it the noise is
  // uniformly distributed across the quad and the result is plasma soup with no
  // hot centre. With it, the core is reliably the hottest thing.
  /**
   * TWO FIELDS FROM ONE NOISE, and keeping them separate is the fix for both
   * ways this went wrong.
   *
   * `body` answers "is there fire here" and drives the ALPHA. `hot` answers "how
   * hot is it" and drives the RAMP. Driving both from one value forces a bad
   * trade: gain it enough to reach the white core and the silhouette swells to
   * fill the disc; keep the silhouette tight and the ramp never leaves its
   * darkest band, which rendered the pool as dull brown patches with no core at
   * all. Both of those were shipped and looked wrong in different directions.
   *
   * The radial bias stays gentle (0.30) so the shape survives out to a decent
   * radius; the concentration comes from `hot`'s gain instead, which brightens
   * the middle without shrinking the flame.
   */
  const body = n.mul(discMask(r, 0.45)).sub(r.mul(0.30));
  // Gain 1.15, not 2.4. `body` peaks around 0.8, so a 2.4 gain saturated almost
  // the whole interior into the top two bands and the pool rendered as a pale
  // cream blob — the palette's warmest colours spent on every pixel, which
  // leaves nothing for a core to be brighter THAN. At 1.15 the body sits in
  // 15-16 (the oranges), 17 appears on the peaks, and 18 needs body > 0.78,
  // which is rare enough to read as the hot heart of the fire.
  const hot = saturate(body.mul(1.15).mul(uIntensity));

  const col = bandRamp(hot, FIRE_RAMP, FIRE_STOPS);

  // A narrow smoothstep, not a hard `step`: one texel of softness stops the
  // edge crawling under the Bayer dither, while still being tight enough that
  // the silhouette reads as flame rather than as fog.
  const alpha = smoothstep(float(cutoff), float(cutoff + 0.10), body).mul(uOpacity);

  material.colorNode = vec4(col, alpha);

  return {
    material,
    uTime,
    uOpacity,
    uIntensity,
    uSeed,
    dispose: () => material.dispose(),
  };
}
