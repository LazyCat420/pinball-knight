/**
 * Shared TSL building blocks for the elemental shaders.
 *
 * ── WHY THESE EFFECTS ARE SHADERS NOW ────────────────────────────────────────
 * Fire and water used to be Canvas2D textures: a radial gradient with ten
 * overlapping circles for fire, and for water a bare tinted disc whose entire
 * animation was `mesh.rotation.z += dt * 0.6`. Both were STAMPS. A stamp can be
 * scaled and faded and spun, and none of those are what fluid does — fluid
 * changes SHAPE. That is a per-pixel function of time, which is a shader.
 *
 * ── THE ONE RULE THAT MAKES THIS WORK: BAND TO PALETTE INDICES ───────────────
 * The pixel pass ends in a Bayer dither and a snap to the nearest of 32 palette
 * colours by a LUMA-WEIGHTED metric. Feed it a smooth free-hex gradient and each
 * pixel lands wherever that metric points — this repo has already measured a
 * warm free-hex wash arriving 26.8% ROT GREEN.
 *
 * So every shader here quantises its own field into a handful of steps and mixes
 * between PALETTE ENTRIES ONLY (see `bandRamp`). Two things fall out of that:
 *   1. the downstream snap becomes a near no-op instead of a lottery, and
 *   2. the banding reads as deliberate cel shading rather than mud.
 * Banding is not a compromise we tolerate here — it is the look.
 *
 * ── COLOUR SPACE ────────────────────────────────────────────────────────────
 * `sceneTarget` is LINEAR. A literal in a `vec3()` bypasses three's colour
 * management entirely, so every colour comes through `palLin` (fx/color.ts).
 * Do NOT convert linear→sRGB in here: the pixel pass does that once, by hand,
 * and a second conversion washes the effect out.
 *
 * ── NOISE FLAVOUR ───────────────────────────────────────────────────────────
 * MaterialX noise is what three ships (`mx_noise_float`, `mx_fractal_noise_*`,
 * `mx_worley_noise_float`) — not ported simplex. The patterns differ from the
 * usual GLSL snippets; tune against what you see, not against a reference image.
 */
import { float, mix, mx_fractal_noise_float, mx_fractal_noise_vec3, mx_noise_float, mx_worley_noise_float, saturate, smoothstep, step, uv, vec2, vec3 } from "three/tsl";
import { palLin } from "../color";

/**
 * TSL's public types are deeply generic in the node's element type, and every
 * operator returns a differently-parameterised type. Threading exact types
 * through a graph that mixes floats and vecs freely would mean annotating every
 * intermediate with a type only the compiler cares about.
 *
 * The graph is validated where it actually matters: three type-checks the node
 * tree when it builds the shader, and the render output is asserted by pixel
 * readback. Same reasoning, same alias, as `engine/render/pixel-pass.ts`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TSLNode = any;

/** A TSL uniform node: opaque in the graph, but `.value` is live from JS. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TSLUniform<T> = any & { value: T };

/**
 * Disc-local coordinates in [-1,1]² from a `CircleGeometry`'s uv.
 *
 * `CircleGeometry` maps uv 0..1 across the quad bounding the circle, so
 * `uv*2-1` puts the centre at the origin and the rim at radius 1 — which makes
 * `length()` of this the normalised radius, and every falloff below a one-liner.
 */
export function discP(): TSLNode {
  return uv().sub(0.5).mul(2.0);
}

/**
 * A soft-edged disc mask: 1 in the core, falling to 0 at the rim.
 *
 * Deliberately NOT the alpha channel. Fire's silhouette comes from thresholding
 * its noise field (that is what makes flame TONGUES); this mask only keeps the
 * field from running off the edge of the quad.
 */
export function discMask(r: TSLNode, inner = 0.55, outer = 1.0): TSLNode {
  return smoothstep(float(outer), float(inner), r);
}

/**
 * DOMAIN WARP — offset the sample point by low-frequency noise before sampling
 * the detail noise.
 *
 * This is the single term that separates "fluid" from "a texture pulsing". Any
 * noise field animated by scrolling time throbs in place; warping the domain
 * makes the features CURL and shear past each other, which is what a flame edge
 * and a water surface actually do. Two octaves is enough — the detail comes
 * from the field being warped, not from the warp being detailed.
 */
export function warp(p: TSLNode, t: TSLNode, scale = 2.3, amount = 0.35): TSLNode {
  const w = mx_fractal_noise_vec3(vec3(p.mul(scale), t.mul(0.55)), 2, 2.0, 0.5);
  return p.add(w.xy.mul(amount));
}

/** Fractal noise remapped from MaterialX's roughly-[-1,1] to [0,1]. */
export function fbm01(sample: TSLNode, octaves = 4): TSLNode {
  return mx_fractal_noise_float(sample, octaves, 2.0, 0.5).mul(0.5).add(0.5);
}

/** Single-octave noise in [0,1] — for slow, large-scale terms like a swell. */
export function noise01(sample: TSLNode): TSLNode {
  return mx_noise_float(sample).mul(0.5).add(0.5);
}

/**
 * Worley (cellular) noise in [0,1]. The cell EDGES are what caustics look like,
 * which is why water reaches for this and fire does not.
 */
export function worley01(sample: TSLNode): TSLNode {
  return saturate(mx_worley_noise_float(sample));
}

/**
 * Quantise `t` (expected 0..1) into `ramp.length` hard bands and return the
 * palette colour for the band it lands in, LINEAR.
 *
 * Implemented as a chain of `mix(prev, next, step(threshold, t))`. `step` is
 * monotonic in `t`, so every threshold below `t` fires and the LAST one wins —
 * which is exactly a lookup, with no branching and no array indexing in the
 * shader.
 *
 * Pass the ramp DARK→BRIGHT. Read the module header for why this exists at all.
 */
export function bandRamp(t: TSLNode, ramp: readonly number[]): TSLNode {
  if (ramp.length === 0) throw new Error("bandRamp: empty ramp");
  const c0 = palLin(ramp[0]!);
  let col: TSLNode = vec3(c0[0], c0[1], c0[2]);
  for (let i = 1; i < ramp.length; i++) {
    const c = palLin(ramp[i]!);
    col = mix(col, vec3(c[0], c[1], c[2]), step(float(i / ramp.length), t));
  }
  return col;
}

/**
 * Central-difference gradient of a scalar field over the disc plane — i.e. a 2D
 * surface normal perturbation, which is all a flat pool needs to catch light.
 *
 * `f` is called four times, so keep it cheap: one noise tap, not a 4-octave
 * fbm. Four taps of a cheap field beats one tap of an expensive one here,
 * because what sells water is the DIRECTION the light moves, not the richness
 * of the height field.
 */
export function gradient2(f: (p: TSLNode) => TSLNode, p: TSLNode, eps = 0.02): TSLNode {
  const e = float(eps);
  const dx = f(p.add(vec2(e, 0.0))).sub(f(p.sub(vec2(e, 0.0))));
  const dy = f(p.add(vec2(0.0, e))).sub(f(p.sub(vec2(0.0, e))));
  return vec2(dx, dy).mul(float(1.0).div(e.mul(2.0)));
}
