/**
 * MOLTEN — the scar a lava marble leaves in the floor it just rolled over.
 *
 * ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────
 * It is not a fire puddle and it is not a groove. Fire is a THING BURNING on top
 * of the stone: additive, ragged-edged, alive. A groove is stone REMOVED: dark,
 * still, permanent-looking. A melt scar is the third thing — stone that briefly
 * became liquid and is setting again — and it has to read as all three of:
 *
 *   · the surface is BELOW the floor (it slumped), so the scar darkens the tile
 *     rather than adding light to it → NormalBlending, like oil and tar. An
 *     additive melt is just a fire puddle with extra steps, which is precisely
 *     what the trail looked like before this file existed.
 *   · it is CRACKED. A cooling melt skins over and the skin splits — the light
 *     comes from BETWEEN the plates, never off them. Same rule the lava ball's
 *     `crust` treatment paints by, so the ball and the floor it melts agree.
 *   · it COOLS. Not fades — cools. Bright fissures narrow and slide down the
 *     torch ramp to a dead char, and the char stays after the glow has gone.
 *
 * ── HOW THE CRACKS ARE MADE ──────────────────────────────────────────────────
 * `worley01` gives the distance to the nearest cell centre, so cell BOUNDARIES
 * are where that distance field peaks — a natural, non-repeating crack lattice
 * of exactly the kind a cooling crust makes. Fissure = the ridge of that field,
 * `smoothstep`ed into a thin line. The plates are what is left over.
 *
 * The lattice does not scroll. A crack that slides across the floor reads as a
 * texture being dragged; real setting rock cracks IN PLACE. What moves instead
 * is the heat INSIDE the cracks (a slow noise scroll along them), which is the
 * convecting melt showing through — motion without the lattice ever moving.
 *
 * ── COOLING IS `uAge`, NOT `uOpacity` ────────────────────────────────────────
 * Fading the whole decal out would take the char with it and leave a clean floor
 * behind a ball that supposedly melted it. The two are separated: `uAge` drives
 * the HEAT (fissure brightness and width, ember colour → dead), `uOpacity` stays
 * near full for most of the life so the scorch persists. See `MELT_COOL_SECONDS`.
 *
 * ── COLOUR ───────────────────────────────────────────────────────────────────
 * Two ramps meeting in one field: char (0 void → 26 leather shadow → 27 leather
 * dark, the only warm darks) for the plates, and the torch ramp's hot end
 * (16 flame → 17 flame light → 18 flame core) for the fissures. 17 and 18 sit
 * above the pass's bloom threshold, so a fresh scar's cracks glow without the
 * material having to add light — the bloom does it.
 */
import { float, length, mix, saturate, smoothstep, uniform, vec3, vec4 } from "three/tsl";
import { bandRamp, discMask, discP, fbm01, warp, worley01, type TSLNode } from "./noise";
import { elementMaterial, type ElementMaterial } from "./element";

/**
 * Dead → barely-warm. The plates. Ordered by luma like every other ramp here.
 * Void 0 is the bottom of the crack shadows, 26/27 are the only warm darks the
 * palette has and they are what stops a burn scar reading as a grey stain.
 */
export const MELT_CHAR_RAMP = [0, 1, 26, 27] as const;
const MELT_CHAR_STOPS = [0.30, 0.58, 0.82] as const;

/** The fissures: ember → flame core. Only the hot end — a fissure is never dim. */
export const MELT_SEAM_RAMP = [14, 16, 17, 18] as const;
const MELT_SEAM_STOPS = [0.34, 0.62, 0.86] as const;

/**
 * Seconds for a scar to go from molten to dead, INDEPENDENT of how long the
 * decal lives. A trail tile lives ~6s but stops glowing well before it vanishes,
 * so a line of them reads as a gradient in TIME — hot right under the ball,
 * cooling behind it, black at the far end. That gradient is the whole effect;
 * a trail that cooled exactly at its despawn would just be a uniform orange
 * snake that blinked out.
 */
export const MELT_COOL_SECONDS = 2.6;

export interface MoltenOpts {
  /**
   * Crack size. Bigger = finer lattice.
   *
   * 2.6, down from a first pass at 5.5 — and the difference is the whole read.
   * A stamp is MELT_RADIUS ≈ 0.46 world units across, so 5.5 cells put four or
   * five crack cells inside a disc barely 30 render pixels wide: measured on a
   * screenshot, the wake came out as a lane of GRAVEL, orange speckle with no
   * structure. At 2.6 a stamp carries roughly one fissure, and because the
   * stamps overlap along the path those single cracks chain into a running
   * split — which is what a floor opening up actually looks like.
   */
  cells?: number;
  /** Fissure line width, in field units. Wider = a more molten, less set scar. */
  seam?: number;
}

export function createMoltenMaterial(opts: MoltenOpts = {}): ElementMaterial & { uAge: ElementMaterial["uTime"] } {
  const { cells = 2.6, seam = 0.34 } = opts;

  const uTime = uniform(0);
  const uOpacity = uniform(1);
  const uIntensity = uniform(1);
  const uSeed = uniform(0);
  const uAge = uniform(0);

  const material = elementMaterial(false); // a scar SITS in the floor; it never adds light

  const p = discP();
  const r = length(p);
  const t = uTime.add(uSeed);

  // How molten this scar still is, 1 → 0. Everything hot below is gated on it.
  const heat = saturate(float(1).sub(uAge.div(float(MELT_COOL_SECONDS)))).mul(uIntensity);

  /**
   * THE LATTICE — fixed in place, seeded per instance so two overlapping stamps
   * do not share one crack pattern (which would make a trail look like a
   * repeating tile, the artefact `uSeed` exists for everywhere else in fx/).
   *
   * `p` is NOT warped or advected here. That is the deliberate half of the
   * effect: see the header.
   */
  const cellField = worley01(vec3(p.mul(cells), uSeed.mul(0.37)));
  // The ridge of the distance field is the cell boundary. Ridge = distance to
  // the crest, so `1 - |field - crest|` peaks along the walls between cells.
  const ridge = float(1).sub(cellField.sub(float(0.42)).abs().mul(float(3.0)));
  // Fissures narrow as the melt sets: a fresh scar is mostly glow with islands
  // of crust, a cold one is crust with hairlines in it.
  const width = float(seam).mul(float(0.45).add(heat.mul(0.55)));
  const fissure = smoothstep(float(1.0).sub(width), float(1.0), saturate(ridge));

  /**
   * The heat INSIDE the cracks. This is the only thing that moves, and it moves
   * ALONG the fixed lattice rather than dragging it: a warped fbm sampled on the
   * unwarped point, so bright and dim stretches travel down a crack that itself
   * never shifts.
   */
  const flow = fbm01(vec3(warp(p, t.mul(0.5), 1.8, 0.22).mul(2.4), t.mul(0.7)), 3);

  // Plate tone. A little noise so the crust is not a flat wash after the snap,
  // and darkest right beside a fissure — the lip of a crack is in shadow.
  const grain = fbm01(vec3(p.mul(3.1), uSeed.mul(0.11)), 2);
  const plate = saturate(grain.mul(0.55).add(float(0.22)).sub(fissure.mul(0.35)));
  const charCol = bandRamp(plate, MELT_CHAR_RAMP, MELT_CHAR_STOPS);

  // Seam tone. Cools bodily: at heat 0 the whole seam ramp collapses onto its
  // dark end, so a spent fissure is an ember line rather than a bright one that
  // simply turned translucent.
  const seamHeat: TSLNode = saturate(flow.mul(0.55).add(float(0.35)).mul(heat));
  const seamCol = bandRamp(seamHeat, MELT_SEAM_RAMP, MELT_SEAM_STOPS);

  // Mix by how much of this texel is fissure, gated by heat so a dead scar is
  // pure char with the crack pattern still legible as shadow.
  const col = mix(charCol, seamCol, fissure.mul(saturate(heat.mul(1.6))));

  /**
   * ALPHA — the scar has a definite edge (unlike fire, whose silhouette is its
   * noise). It is stamped in an overlapping line, so like the groove texture it
   * must be soft at the rim: a hard disc turns a trail into a string of beads.
   *
   * The char does NOT fade with the heat — `uOpacity` is the only fade, and
   * floor-fx holds it high until the tile's last third. A melt that faded as it
   * cooled would leave a spotless floor behind the ball.
   */
  const alpha = discMask(r, 0.35, 1.0).mul(float(0.55).add(fissure.mul(0.45))).mul(uOpacity);

  material.colorNode = vec4(col, alpha);

  return { material, uTime, uOpacity, uIntensity, uSeed, uAge, dispose: () => material.dispose() };
}
