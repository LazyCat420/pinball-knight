/**
 * FROST — a crystal that CREEPS, not a puddle that pulses.
 *
 * ── THE DESIGN CONSTRAINT THIS INHERITS ──────────────────────────────────────
 * The Canvas2D version this replaces carried an explicit note worth preserving:
 * *"angular where every liquid here is round, because 'ice' is a shape before it
 * is a colour"*. That is exactly right, and it is why frost is the one elemental
 * that does NOT reach for the smooth fbm the others use.
 *
 *   · **Worley noise, low exponent.** Cell EDGES are straight and meet at
 *     angles — polygonal facets, not blobs. A fractal-noise frost would be a
 *     pale version of water, which is the one thing it must not read as.
 *   · **A growth FRONT, from `uAge`.** The old version rotated the quad at
 *     `dt * 0.09` to gesture at "a crystal creeping". Rotation is not growth. Here
 *     the mask expands with the decal's own age, so the rune genuinely spreads
 *     outward from where it was struck and then holds.
 *   · **Radiating spokes** survive from the old painter, but as an angular
 *     function rather than six stroked lines — so they exist at every scale
 *     instead of being six sub-texel strokes at the sizes the game actually uses.
 *
 * Additive, like fire and the rod: it should glow COLD against stone the way
 * fire glows hot. And like fire, the colour is scaled by its own intensity, so
 * the dim outer edge cannot tint the floor into another palette family — see
 * `fire.ts` for the pink-fire incident that rule comes from.
 */
import { abs, atan, cos, float, length, saturate, smoothstep, uniform, vec3, vec4 } from "three/tsl";
import { bandRamp, discMask, discP, noise01, worley01 } from "./noise";
import { elementMaterial, type ElementMaterial } from "./element";

/** Ink → deep arcane → bright arcane → white crystal. */
export const FROST_RAMP = [1, 29, 31, 22] as const;
/** Bright entries kept high, so the white is a facet edge and not the body. */
const FROST_STOPS = [0.20, 0.52, 0.82] as const;

export interface FrostMaterial extends ElementMaterial {
  /** Seconds since the rune was struck — drives the growth front. SIM time. */
  uAge: ElementMaterial["uTime"];
}

export function createFrostMaterial(): FrostMaterial {
  const uTime = uniform(0);
  const uOpacity = uniform(1);
  const uIntensity = uniform(1);
  const uSeed = uniform(0);
  const uAge = uniform(0);

  const material = elementMaterial(true); // frost ADDS light — it glows cold

  const p = discP();
  const r = length(p);
  const t = uTime.add(uSeed);

  // The growth front: 0.35 of the disc at birth, full by ~1.2s, then held. A
  // crystal spreads and stops; it does not breathe.
  const grown = saturate(uAge.mul(0.85).add(0.35));
  const mask = smoothstep(grown, grown.mul(0.55), r);

  // Angular spokes. `atan(y, x)` gives the bearing; a cosine of a multiple of it
  // is a star with as many arms as the multiple — resolution-independent, unlike
  // six stroked lines that vanish at 72 px/unit.
  const ang = atan(p.y, p.x);
  const spokes = abs(cos(ang.mul(3.0).add(uSeed))).mul(0.5).add(0.5);

  // Cell edges: 1 - worley is bright AT the boundaries. A low exponent keeps the
  // facets broad and straight rather than sharpening them into filaments.
  const cells = worley01(vec3(p.mul(4.2), t.mul(0.12)));
  const facets = saturate(cells.oneMinus().mul(1.4));

  // A very slow shimmer so the ice is not perfectly dead — but slow enough that
  // it reads as light moving over a solid, not as a liquid surface.
  const shimmer = noise01(vec3(p.mul(2.6), t.mul(0.35))).mul(0.18);

  const cold = saturate(
    mask.mul(facets.mul(0.55).add(spokes.mul(0.30)).add(shimmer)).mul(uIntensity),
  );

  const col = bandRamp(cold, FROST_RAMP, FROST_STOPS);
  const alpha = smoothstep(float(0.10), float(0.26), cold).mul(uOpacity);

  // Emission scaled by the field, for the reason documented in fire.ts: an
  // additive dim edge would sum with the floor and land off-family.
  material.colorNode = vec4(col.mul(cold), alpha);

  return { material, uTime, uOpacity, uIntensity, uSeed, uAge, dispose: () => material.dispose() };
}
