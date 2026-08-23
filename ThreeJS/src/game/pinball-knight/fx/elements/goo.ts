/**
 * OIL and TAR — one graph, two parameter sets, because they have to read as
 * opposites.
 *
 * ── WHY ONE FILE ─────────────────────────────────────────────────────────────
 * The Canvas2D versions carried a strong and correct design note: oil says *"look
 * at me and then slide"*, tar says *"there is nothing here and you will stop"*.
 * They are the same substance mechanically — a viscous pool — and gameplay-wise
 * exact inverses (oil gives the ball glide, tar cancels a skid and bleeds speed).
 *
 * Expressing that as two hand-painted canvases meant the contrast lived in two
 * places and could drift. Here it is three parameters:
 *
 *   | | oil | tar |
 *   |---|---|---|
 *   | `film` (iridescence) | 1.0 | **0** — tar has no sheen at all |
 *   | `rim` (edge light)   | 0.9 | **0** — no rim light, so no highlight to catch |
 *   | `flow` (swirl speed) | 1.0 | **0.12** — all but stopped |
 *
 * Tar being visually dead is not laziness, it is the read. A trap that looks
 * inviting and a trap that looks inert teach the player two different things.
 *
 * ── IRIDESCENCE WITHOUT LEAVING THE PALETTE ──────────────────────────────────
 * A petrol sheen is a thin-film interference effect — hue cycling with thickness.
 * The honest way to draw that is an actual hue sweep, which this palette cannot
 * afford: 32 entries with exactly three blues and no purples or greens outside
 * the rot family. So instead of cycling HUE, the film term cycles POSITION along
 * the arcane ramp plus steel dark (29 → 30 → 31 → 19), which is the closest thing
 * to a cool metallic sweep the palette has. It reads as sheen because it MOVES
 * and because it sits on near-black, not because it is spectrally correct.
 *
 * Both sit ON the scene (NormalBlending) — a glowing oil slick would read as
 * lava, and a glowing tar pit would defeat the entire point of tar.
 */
import { float, length, saturate, sin, smoothstep, uniform, vec3, vec4 } from "three/tsl";
import { bandRamp, discMask, discP, noise01, warp } from "./noise";
import { elementMaterial, type ElementMaterial } from "./element";

/**
 * Near-black body → cool sheen.
 *
 * Ordered strictly by LUMA, which is not the same as ordering by how the names
 * read. Steel dark (19) is a warm violet-slate and sits between arcane dark and
 * arcane mid in brightness, so it goes there — putting it at the top, where
 * "steel highlight" instinct suggests, made the ramp fall from 0.543 to 0.082 and
 * `bandRamp`'s `step` chain would have rendered the bands out of order.
 */
export const OIL_RAMP = [0, 26, 29, 19, 30, 31] as const;
const OIL_STOPS = [0.14, 0.34, 0.52, 0.70, 0.88] as const;

/** Tar: void → leather shadow → leather dark. Warm, matte, and it STOPS there. */
export const TAR_RAMP = [0, 26, 27] as const;
const TAR_STOPS = [0.30, 0.68] as const;

export interface GooOpts {
  /** Iridescent thin-film strength. 0 = matte (tar). */
  film?: number;
  /** Rim light strength. 0 = no highlight to catch (tar). */
  rim?: number;
  /** Swirl speed multiplier. */
  flow?: number;
  /** Which ramp to band into. */
  ramp?: readonly number[];
  stops?: readonly number[];
}

function createGoo(opts: GooOpts): ElementMaterial {
  const { film = 1, rim = 0.9, flow = 1, ramp = OIL_RAMP, stops = OIL_STOPS } = opts;

  const uTime = uniform(0);
  const uOpacity = uniform(1);
  const uIntensity = uniform(1);
  const uSeed = uniform(0);

  const material = elementMaterial(false); // sits ON the scene, never adds

  const p = discP();
  const r = length(p);
  const t = uTime.add(uSeed);

  // A lazy warp — heavy liquid. Oil's swirl is slow; tar's is nearly frozen.
  const wp = warp(p, t.mul(0.18 * flow), 1.4, 0.16);

  // Thickness: thicker in the middle, thinning to the edge. This is what the
  // film term interferes over, so it has to vary smoothly and slowly.
  const thick = noise01(vec3(wp.mul(2.1), t.mul(0.22 * flow)));

  // Thin-film sweep. `sin` of thickness × a frequency gives the banded
  // interference pattern; adding the radius tilts the bands toward the rim the
  // way a real film thins at the edge of a puddle.
  const sheen = film === 0
    ? float(0)
    : sin(thick.mul(9.0).add(r.mul(2.4)).add(t.mul(0.5 * flow))).mul(0.5).add(0.5).mul(float(film));

  // The rim: oil catches light at its boundary, which is most of what makes it
  // legible on dark stone. Tar gets none — that is the whole distinction.
  const edge = rim === 0 ? float(0) : smoothstep(float(0.70), float(0.99), r).mul(float(rim));

  const body = saturate(
    thick.mul(0.34).add(sheen.mul(0.40)).add(edge.mul(0.42)).mul(uIntensity),
  );

  const col = bandRamp(body, ramp, stops);
  // Alpha from the disc: a pool has a definite edge. Oil is near-opaque because
  // it has to hide the floor to read as a pool rather than a stain.
  const alpha = discMask(r, 0.92, 1.0).mul(uOpacity);

  material.colorNode = vec4(col, alpha);

  return { material, uTime, uOpacity, uIntensity, uSeed, dispose: () => material.dispose() };
}

/** A spilled pool: near-black with an iridescent rim and a slow sheen. */
export function createOilMaterial(): ElementMaterial {
  return createGoo({ film: 1, rim: 0.9, flow: 1, ramp: OIL_RAMP, stops: OIL_STOPS });
}

/**
 * Oil's exact inverse. Deliberately the dullest thing on the floor: no sheen, no
 * rim, barely any motion. If it ever starts looking interesting, that is a bug.
 */
export function createTarMaterial(): ElementMaterial {
  return createGoo({ film: 0, rim: 0, flow: 0.12, ramp: TAR_RAMP, stops: TAR_STOPS });
}
