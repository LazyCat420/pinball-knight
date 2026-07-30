/**
 * WATER — travelling ripples, a real Fresnel rim, caustics, and a torch glint.
 *
 * ── WHAT WAS WRONG BEFORE ────────────────────────────────────────────────────
 * The water slick was the only floor kind with no texture at all: a bare
 * `MeshBasicMaterial` tinted palette-30 at opacity 0.4. Its entire animation was
 * `mesh.rotation.z += dt * 0.6` — a spinning flat disc. A comment beside it
 * claimed a flat tint "worked for water". It did not; it just failed less
 * obviously than it did for fire, because a still puddle is a more plausible
 * object than a still flame.
 *
 * ── THE CAMERA NEVER MOVES, AND THAT IS AN ASSET ─────────────────────────────
 * `CAMERA_TILT` is 38° and `CAMERA_YAW` is 45°, both fixed. So the surface→eye
 * vector is a COMPILE-TIME CONSTANT, and we can do real Schlick Fresnel against
 * it for the price of a dot product:
 *
 *     V_EYE = (sin45·cos38, sin38, cos45·cos38) = (0.5572, 0.6157, 0.5572)
 *
 * Flat surface: `dot(N,V) = 0.6157` → F = 0.02 + 0.98·(1−0.6157)^5 ≈ 0.029.
 * Tilt a ripple crest ~25° toward the camera: `1−dot` climbs to ≈0.60 → F ≈ 0.098.
 *
 * **A 3.4× Fresnel swing, driven entirely by the ripple normal.** That number is
 * the whole justification for computing a perturbed normal here: a "Fresnel rim"
 * on an unperturbed disc is a constant, i.e. invisible. The normal is not
 * decoration, it is the term that makes every other term move.
 *
 * ── THE FIVE TERMS ───────────────────────────────────────────────────────────
 * 1. HEIGHT — three wave packets at pairwise-incommensurate frequencies
 *    (14/19/27, so nothing visibly repeats across the disc) with their PHASE
 *    warped by slow noise. Summed sines alone read as corduroy; warping the
 *    phase is what makes it water. Plus an impact ring that expands and decays
 *    from the splash — nearly free, and the strongest single "this is liquid" cue.
 * 2. NORMAL — central differences of the height field. Deterministic, unlike
 *    `dFdx` on a NearestFilter low-res target.
 * 3. FRESNEL — Schlick against the constant V_EYE, above.
 * 4. CAUSTICS — two counter-drifting Worley fields MULTIPLIED. Cell edges are
 *    the shape of light through a rippled surface; multiplying two gives the
 *    classic web rather than a blobby overlay.
 * 5. TORCH GLINT — Blinn-Phong against the nearest torch's world position. The
 *    game already sorts torch anchors by distance every frame to park six
 *    PointLights; feeding the nearest one in here costs one uniform. Because N
 *    travels, the glint SLIDES ACROSS the puddle — which says "liquid" louder
 *    than any colour choice, and is exactly what a decal cannot do.
 *
 * ── COLOUR ───────────────────────────────────────────────────────────────────
 * Ink 1 → arcane 29 → 30 → 31 → steel highlight 22. The arcane ramp is the only
 * blue this palette has, and it is the SAME ramp the water marble is painted
 * from, so the puddle and the ball agree about what water is made of. Banded,
 * per the rule in `noise.ts` — travelling BANDS rather than a travelling
 * gradient is the classic pixel-art water read, and it is a no-op under the
 * pass's palette snap.
 */
import { dot, exp, float, length, max, normalize, pow, saturate, sin, smoothstep, uniform, vec2, vec3, vec4 } from "three/tsl";
import { bandRamp, discMask, discP, noise01, type TSLNode } from "./noise";
import { elementMaterial, type ElementMaterial } from "./element";
import { CAMERA_TILT, CAMERA_YAW } from "../../constants";

/** Deep → shallow → foam. Arcane 29-31 plus steel highlight for the crest. */
export const WATER_RAMP = [1, 29, 30, 31, 22] as const;

/**
 * Where the bands change. Tuned so a puddle reads DEEP BLUE at rest.
 *
 * The first version used equal widths and rendered solid foam-white — the lit
 * field spends most of its range above 0.5, so equal bands put the top colour
 * everywhere. These push the two bright entries (31 arcane light, 22 foam) up
 * where only a caustic hit or a specular crest reaches them, which is what makes
 * them read as highlights rather than as the base colour.
 */
const WATER_STOPS = [0.14, 0.32, 0.70, 0.90] as const;

/**
 * Surface → eye, for a flat +Y disc under this game's fixed orthographic camera.
 * A constant, because the camera is. See the header for the Fresnel arithmetic
 * this unlocks.
 */
const V_EYE: readonly [number, number, number] = [
  Math.sin(CAMERA_YAW) * Math.cos(CAMERA_TILT),
  Math.sin(CAMERA_TILT),
  Math.cos(CAMERA_YAW) * Math.cos(CAMERA_TILT),
];

export interface WaterOpts {
  /** Ripple speed. Oil wants this slow, water lively. */
  speed?: number;
  /** Caustic strength. 0 turns them off. */
  caustic?: number;
  /** Normal steepness — how hard the ripples catch light. */
  bump?: number;
  /** Peak alpha. */
  alpha?: number;
}

export interface WaterMaterial extends ElementMaterial {
  /** Torch flicker 0..1 — drive from the same sines as the torch PointLights. */
  uTorch: ElementMaterial["uTime"];
  /** Nearest torch, world space. The glint's light position. */
  uTorchPos: { value: { x: number; y: number; z: number } };
  /** Seconds since this puddle landed. Drives the impact ring — SIM time, so it
   *  matches the decal's gameplay lifetime rather than the noise scroll. */
  uAge: ElementMaterial["uTime"];
}

export function createWaterMaterial(opts: WaterOpts = {}): WaterMaterial {
  const { speed = 1.0, caustic = 1.0, bump = 1.0, alpha = 1.0 } = opts;

  const uTime = uniform(0);
  const uOpacity = uniform(1);
  const uIntensity = uniform(1);
  const uSeed = uniform(0);
  const uTorch = uniform(1);
  const uAge = uniform(0);
  const uTorchPos = uniform(vec3(0, 1, 0));

  const material = elementMaterial(false); // water sits ON the scene, never adds

  const c = discP();
  const r = length(c);
  const t = uTime.add(uSeed);

  // ── 1. HEIGHT ─────────────────────────────────────────────────────────────
  // Phase warp: one slow noise tap shared by all three packets, so they stay
  // coherent with each other while none of them scrolls in a straight line.
  const ph = noise01(vec3(c.mul(2.0), t.mul(0.25))).mul(1.5);

  // Called four times by the gradient below, so it stays cheap on purpose: what
  // sells water is the DIRECTION the light moves, not a rich height field.
  const H = (p: TSLNode): TSLNode => {
    const w1 = sin(dot(p, vec2(0.92, 0.39)).mul(14.0).sub(t.mul(2.7 * speed)).add(ph)).mul(0.55);
    const w2 = sin(dot(p, vec2(-0.44, 0.90)).mul(19.0).sub(t.mul(3.6 * speed)).add(ph.mul(1.3))).mul(0.34);
    const w3 = sin(dot(p, vec2(0.31, -0.95)).mul(27.0).sub(t.mul(4.9 * speed)).add(ph.mul(0.7))).mul(0.20);
    // The impact ring: a wavefront travelling out from the splash, decaying.
    const ring = sin(length(p).mul(22.0).sub(uAge.mul(9.0))).mul(exp(uAge.mul(-2.4)));
    return w1.add(w2).add(w3).add(ring);
  };

  // ── 2. NORMAL by central difference ───────────────────────────────────────
  const e = float(0.012);
  const hx = H(c.add(vec2(e, 0.0))).sub(H(c.sub(vec2(e, 0.0))));
  const hz = H(c.add(vec2(0.0, e))).sub(H(c.sub(vec2(0.0, e))));
  const n = normalize(vec3(hx.mul(-bump), e.mul(2.0), hz.mul(-bump)));

  const v = vec3(V_EYE[0], V_EYE[1], V_EYE[2]);

  // ── 3. FRESNEL (Schlick). See the header for why this is worth 3.4×.
  // SATURATED, not gained. Schlick's (1-cos)^5 is unbounded in practice once the
  // normal swings past grazing, and an ungained-but-unclamped term here summed
  // past 1 on its own — which is how the first version rendered a solid white
  // puddle. Clamp first, weight second.
  const ndv = max(float(0.0), dot(n, v));
  const fres = saturate(pow(ndv.oneMinus(), float(5.0)).mul(0.98).add(0.02).mul(4.0));

  // ── 5. TORCH GLINT — Blinn-Phong half-vector against the nearest torch.
  // `uTorchPos` is a world position but the disc is small, so treating the
  // light as directional from the puddle's centre is within a pixel.
  const l = normalize(uTorchPos);
  const half = normalize(l.add(v));
  const spec = pow(max(float(0.0), dot(n, half)), float(48.0)).mul(uTorch);

  // ── 4. CAUSTICS — two counter-drifting cell fields, multiplied. The product
  // is what gives the sparse travelling WEB; either field alone is a blobby
  // overlay. `pow` sharpens it so only the brightest crossings survive.
  const flow = vec2(t.mul(0.16 * speed), t.mul(-0.11 * speed));
  const k1 = noise01(vec3(c.mul(6.0).add(flow), t.mul(0.3 * speed)));
  const k2 = noise01(vec3(c.mul(9.5).sub(flow.mul(1.7)), t.mul(0.4 * speed)));
  const caustics = saturate(pow(k1.mul(k2), float(2.2)).mul(float(caustic * 4.0)));

  // The rim draws the puddle's BOUNDARY — a player has to be able to read the
  // edge to treat it as a hazard. It must brighten toward the outside: the first
  // version had this inverted and added a constant 0.7 across the entire disc,
  // which on its own put every pixel in the top band.
  const rim = smoothstep(float(0.72), float(0.98), r).mul(0.55);

  /**
   * The lit field, with an explicit CONSTANT BASE.
   *
   * The base term is load-bearing and was missing at first. Without it the
   * additive terms alone averaged ~0.17, which sits on the very first band
   * boundary — so a puddle at rest rendered in ink (palette 1) and, being
   * translucent, just darkened whatever floor was underneath. On a mossy green
   * biome that read as a green stain, with no blue in it anywhere.
   *
   * 0.22 puts the resting surface in the middle of arcane mid (palette 30) — an
   * actual readable blue — and leaves 31 and 22 for crests and caustics. Every
   * term is clamped before it is weighted, and at rest the sum lands near 0.4
   * rather than pinning at either end of the ramp.
   */
  const lit = saturate(
    float(0.22)
      .add(H(c).mul(0.5).add(0.5).mul(0.34))
      .add(fres.mul(0.14))
      .add(rim.mul(0.24))
      .add(spec.mul(0.28))
      .add(caustics.mul(0.20))
      .mul(uIntensity),
  );

  const col = bandRamp(lit, WATER_RAMP, WATER_STOPS);

  // A puddle is a SURFACE: its silhouette stays a disc. This is the deliberate
  // opposite of fire, where the noise field owns the outline — water with a
  // ragged mobile edge reads as something burning.
  const a = discMask(r, 0.90, 1.0).mul(uOpacity).mul(float(alpha));

  material.colorNode = vec4(col, a);

  return {
    material,
    uTime,
    uOpacity,
    uIntensity,
    uSeed,
    uTorch,
    uTorchPos: uTorchPos as unknown as WaterMaterial["uTorchPos"],
    uAge,
    dispose: () => material.dispose(),
  };
}
