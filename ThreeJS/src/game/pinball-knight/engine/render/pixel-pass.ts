/**
 * The pixel/cel post pipeline — this is what makes 3D geometry read as a
 * flat-banded, ink-outlined cel picture, now with real depth cues.
 *
 *   scene ──▶ sceneTarget (adaptive size, Nearest, LINEAR colour, + depth tex)
 *      │
 *      ├──▶ bloom chain (half-res): bright-pass → blur H → blur V → bloomTarget
 *      │
 *      ▼
 *   fullscreen quad, final ShaderMaterial (reads sceneTarget + bloom + depth)
 *      ├─ screen-space AO from the depth buffer  (darkens concave corners)
 *      ├─ + bloom                                (torches/arcane bleed light)
 *      ├─ linear → sRGB (done by hand, see below)
 *      ├─ depth-discontinuity ink outline
 *      ├─ Bayer 4x4 ordered dither
 *      ├─ snap to nearest of 32 palette colours (luma-weighted)
 *      └─ optional scanlines
 *      │
 *      ▼
 *   canvas (integer-scaled)
 *
 * COLOUR MANAGEMENT — read before touching this.
 * sceneTarget uses the default (no) colour space, so three.js writes LINEAR
 * values into it. AO and bloom are therefore applied in LINEAR (the physically
 * right place), and we convert linear→sRGB ourselves in the final shader and
 * compare against the sRGB palette. We must NOT let three.js do an output
 * conversion on any of these quads too, or it'd double-encode — which it won't,
 * because a custom ShaderMaterial that doesn't `#include <colorspace_fragment>`
 * gets no injected conversion. Tone mapping is off (NoToneMapping).
 *
 * WHY NOT EffectComposer / UnrealBloomPass / SSAOPass? Those own the colour
 * pipeline and expect sRGB in/out; wiring them around this hand-managed linear
 * target and the bespoke quantizer is more fragile than the ~3 tiny quads
 * here. Everything stays under our control and in one file.
 *
 * PIXEL GRID — ADAPTIVE INTEGER RENDER SIZE (2026-07-19). See
 * `computeRenderSizing` below for the rule and for what the old fixed-target /
 * fractional-upscale scheme got wrong.
 */
import * as THREE from "three";
import type { WebGPURenderer } from "three/webgpu";
import { BlendMode, NodeMaterial } from "three/webgpu";
import {
  diffuseColor,
  dot,
  float,
  floor,
  fract,
  length,
  max,
  min,
  mix,
  mod,
  mrt,
  mx_fractal_noise_float,
  output,
  pow,
  screenCoordinate,
  smoothstep,
  sqrt,
  step,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

/**
 * TSL's public types are deeply generic in the node's element type ("float",
 * "vec3", …) and every operator returns a differently-parameterised type. A
 * shader graph mixes those freely — `dot()` takes vec3s and yields a float,
 * `select()` unions two branches — so threading exact types through would mean
 * annotating every intermediate with a type only the compiler cares about.
 *
 * The graph is validated where it actually matters: three type-checks the node
 * tree when it builds the shader, and the render output is asserted by pixel
 * readback in the playtest harness. So the local alias is deliberately loose.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSLNode = any;

/** A TSL uniform node: opaque in the graph, but `.value` is live from JS. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSLUniform<T> = any & { value: T };
import { engineConfig } from "../config";
import { enginePalette } from "../palette-source";

// Local aliases for the injected tuning — see the note in sprite.ts.
const {
  renderW: RENDER_W,
  renderH: RENDER_H,
  maxRenderW: MAX_RENDER_W,
  maxRenderH: MAX_RENDER_H,
  bloomThreshold: BLOOM_THRESHOLD,
  bloomStrength: BLOOM_STRENGTH,
  bloomRadius: BLOOM_RADIUS,
  aoRadius: AO_RADIUS,
  aoStrength: AO_STRENGTH,
  vignette: VIGNETTE,
  outlineEdgeThreshold: OUTLINE_EDGE_THRESHOLD,
  frenzyVignette: FRENZY_VIGNETTE,
  frenzyAberration: FRENZY_ABERRATION,
  celSteps: CEL_STEPS,
  celCurve: CEL_CURVE,
  celSaturation: CEL_SATURATION,
} = engineConfig.post;
const { ppu: PPU } = engineConfig.camera;

/**
 * ── THE POST CHAIN IS TSL, NOT GLSL ────────────────────────────────────────
 *
 * Same three passes, same maths, same order. What changed is only the language:
 * WebGPURenderer compiles node graphs, and a raw `ShaderMaterial` is rejected
 * outright ("Material ShaderMaterial is not compatible") — which renders a
 * COMPLETELY BLACK screen while the game logic keeps ticking happily.
 *
 * The deliberate decision at the top of this file still stands: no
 * EffectComposer, no stock bloom pass. This pipeline owns its colour handling
 * against a hand-managed LINEAR target, and the backend does not change that.
 *
 * The one genuine semantic difference is UV ORIGIN — and it is NOT a no-op.
 * Under WebGPURenderer (BOTH backends), sampling a RENDER TARGET's texture
 * with `uv()` on a fullscreen quad reads it v-flipped relative to what the
 * legacy WebGLRenderer + ShaderMaterial idiom read. Every RT sampling hop in
 * this file therefore goes through `rtUv()` below, which flips v back.
 *
 * How this was proven (2026-07-26, after three sessions chased textures):
 * with NO compensation, the presented frame was upside down while its BLOOM
 * was upright — the diffuse path is one sampling hop (odd ⇒ net flip), the
 * bloom path is four (even ⇒ cancels). Mirrored bokeh floating in the void
 * above the tavern was displaced marquee bloom. One flip per hop is the only
 * model consistent with both, so the fix is one explicit flip per hop — NOT
 * `flipY=false` on scene textures, which "fixes" each texture in isolation
 * while leaving the world, sprites and geometry inverted (that was shipped
 * TWICE, e1426d2 and 38484a6, and reverted with this change).
 *
 * `transitions/raccoon-intro.ts` is the same seam fixed the same way (its
 * blit quad's UV attribute is flipped — a9eab59).
 */

/** RT-sampling UV: v-flipped to undo the node renderer's render-target flip. */
function rtUv(): TSLNode {
  const u = uv();
  return vec2(u.x, u.y.oneMinus());
}

// ── Bloom: bright-pass ──────────────────────────────────────────
// Keep only what's brighter than the threshold, softly. Runs in linear.
function brightNode(src: THREE.Texture, threshold: TSLNode): TSLNode {
  const c = texture(src, rtUv()).rgb;
  const l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  const k = l.sub(threshold).div(max(float(1).sub(threshold), float(0.001))).clamp(0, 1);
  return vec4(c.mul(k), 1);
}

// ── Bloom: separable 9-tap gaussian ─────────────────────────────
// Normalised gaussian weights (sigma ~2) — identical taps to the GLSL version.
const BLUR_W = [0.227027, 0.194595, 0.121622, 0.054054, 0.016216] as const;
function blurNode(src: THREE.Texture, dir: TSLNode): TSLNode {
  // Offsets ride on the flipped base UV; the kernel is symmetric (±each tap),
  // so the flipped v-direction of `dir` changes nothing.
  const at = (o: TSLNode): TSLNode => texture(src, rtUv().add(o)).rgb;
  let c: TSLNode = at(vec2(0, 0)).mul(BLUR_W[0]);
  for (let i = 1; i <= 4; i++) {
    const step = dir.mul(float(i));
    c = c.add(at(step).mul(BLUR_W[i])).add(at(step.negate()).mul(BLUR_W[i]));
  }
  return vec4(c, 1);
}

/** Uniform handles for the final composite, so render()/setters can poke them. */
interface FinalUniforms {
  quantize: TSLUniform<number>;
  dither: TSLUniform<number>;
  scanline: TSLUniform<number>;
  outline: TSLUniform<number>;
  /** 0/1 — is the colour-edge outline term live? */
  colourOutline: TSLUniform<number>;
  /** 0/1 — is the cel grade (luma posterize + saturation) live? */
  cel: TSLUniform<number>;
  /** Luma rungs the posterize snaps to. */
  celSteps: TSLUniform<number>;
  /** Exponent the rungs are spaced on; 1 = evenly. See the grade in `finalNode`. */
  celCurve: TSLUniform<number>;
  /** Saturation multiplier about each pixel's own luma. */
  celSaturation: TSLUniform<number>;
  /** Luma step (in rough-gamma space) a colour edge must exceed to be inked. */
  edgeThreshold: TSLUniform<number>;
  bloom: TSLUniform<number>;
  ao: TSLUniform<number>;
  aoRadius: TSLUniform<number>;
  vignette: TSLUniform<number>;
  /** 0 while nothing is on the UI layer — see the composite in `finalNode`. */
  ui: TSLUniform<number>;
  aberration: TSLUniform<number>;
  flash: TSLUniform<number>;
  /** Master heat-shimmer gain, 0 = off. */
  heat: TSLUniform<number>;
  /** Peak displacement, in RENDER pixels. */
  heatPixels: TSLUniform<number>;
  /** Seconds. Poked from the frame loop — NOT TSL's `time`, which this app never
   *  advances (see the note on the elemental shaders' clock). */
  heatTime: TSLUniform<number>;
  /** xy = RT-UV centre, z = radius in UV. An unused slot has z = 0. */
  heatSpots: TSLUniform<THREE.Vector3>[];
  resolution: TSLUniform<THREE.Vector2>;
}

/**
 * How many heat sources the shimmer is unrolled over.
 *
 * Unrolled rather than looped, matching this file's existing idiom (a 16-tap AO
 * ring, a 32-way palette snap): the count is a compile-time constant and an
 * unused slot has radius 0, so it contributes exactly nothing. Eight is enough
 * for every fire a player can reasonably have on screen; `fx/heat.ts` keeps the
 * strongest eight and LOGS when it drops any, because a silent top-N cap reads as
 * "covered everything".
 */
const HEAT_SPOTS = 8;

/**
 * Peak shimmer displacement, in RENDER pixels.
 *
 * Small on purpose. At `PPU` render pixels per world unit a displacement of more
 * than a couple of pixels stops reading as heat and starts reading as a broken
 * frame — the geometry visibly tears rather than wavers. 2.5 is about the largest
 * value where the effect still looks like air.
 */
const HEAT_PIXELS = 2.5;

/**
 * ── HEAT SHIMMER ───────────────────────────────────────────────────────────
 *
 * Returns a WARPED scene UV. Applied to the scene taps only — colour, depth and
 * bloom — and deliberately NOT to the vignette, the dither or the scanlines.
 *
 * ── WHY IT WARPS THE FETCH, BEFORE EVERYTHING ────────────────────────────────
 * Shimmer is a REFRACTION: physically it offsets what you would see, so it has to
 * displace the scene lookup rather than smear the result. Three consequences, and
 * the third is the one that makes it work at all:
 *
 * 1. It costs no extra pass. It perturbs the `rtUv()` coordinate the chain was
 *    already going to sample.
 * 2. There is nothing downstream to re-fetch — the whole chain is one shader with
 *    one output — so "after the quantize" would mean a second full pass over the
 *    presented image. Resampling an already-snapped frame with LinearFilter
 *    invents off-palette blends and with NearestFilter gives wobbling stair-steps.
 *    Either way the pass's central invariant (every presented pixel IS a palette
 *    entry) dies.
 * 3. Warping BEFORE the quantize is what makes it read. The displaced geometry
 *    gets re-dithered and re-snapped on the true pixel grid, so the shimmer
 *    appears as pixels SWAPPING PALETTE BANDS — which is the authentic retro
 *    heat-haze look, and the only version that survives 32 colours.
 *
 * All scene taps share one warped UV so the SSAO ring and the outline's
 * neighbour taps stay registered with the colour they shade — an ink line that
 * stayed straight while its fill wobbled would read as a bug.
 */
function heatWarp(base: TSLNode, u: FinalUniforms, res: TSLNode): TSLNode {
  const t = u.heatTime;
  // Sampled in SCREEN space, so the haze does not swim with the camera. Two
  // octaves is plenty for a 1-2 pixel displacement.
  const sp = base.mul(vec2(26.0, 14.0));
  const n1 = mx_fractal_noise_float(vec3(sp, t.mul(1.7)), 2, 2.0, 0.5);
  const n2 = mx_fractal_noise_float(vec3(sp.add(9.4), t.mul(2.1)), 2, 2.0, 0.5);

  let amp: TSLNode = float(0);
  for (let i = 0; i < HEAT_SPOTS; i++) {
    const s = u.heatSpots[i]!;
    const d = length(base.sub(vec2(s.x, s.y)));
    // `step` on the radius zeroes unused slots: smoothstep(0, 0, d) is degenerate
    // and would otherwise contribute a full-strength wobble everywhere.
    amp = amp.add(smoothstep(s.z, float(0), d).mul(step(float(0.0001), s.z)));
  }
  amp = min(amp, float(1.6)).mul(u.heat);

  // Biased UPWARD (the -0.35 on the second channel): rising air, not a wobbling
  // lens. Kept to a couple of render pixels — at 72 px/unit anything larger reads
  // as a glitch rather than as heat.
  const off = vec2(n1.mul(0.55), n2.sub(0.35)).mul(amp).mul(u.heatPixels).div(res);
  return base.add(off);
}

/**
 * ── Final composite + cel quantize ─────────────────────────────────────────
 *
 * The whole art direction lives here, in this order (the order IS the look):
 * chromatic aberration → AO → bloom → linear→sRGB → vignette → ink outline →
 * flash → dither → palette snap → scanlines.
 *
 * The GLSL original branched with `if`. TSL is a graph, so a runtime `if` on a
 * uniform would have to be `Fn`/`If` nodes; instead each toggle is folded into
 * a `mix(off, on, flag)` where the flag is already 0/1. Same result, no
 * divergence, and the uniform stays pokeable from JS.
 */
/**
 * How many rows of shadow the quantizer can walk.
 *
 * The longest family ramp is stone (6 entries) and every family terminates at
 * void, so six walks take ANY entry to black — palette-shading.test.ts asserts
 * exactly that of the deepest row. More rows would be dead texture; fewer would
 * make the darkest shadow in the game arbitrary rather than black.
 */
const SHADE_ROWS = 6;

/**
 * How many rows of HIGHLIGHT the quantizer can walk — the ramp above the
 * material's own entry.
 *
 * These did not exist while the snap ran on the lit colour, and their absence
 * was invisible: a torch-lit surface had already been snapped to some brighter
 * family's entry, so it never needed to walk up its own. Snapping on ALBEDO
 * makes them load-bearing. Measured over the four biomes and 48 shading
 * situations (`render/light-crossing.ts`), the frame's luma runs from 0.38x to
 * 1.35x of its albedo's: without upward rows everything above unity clamps at
 * the identity row, the torches stop brightening anything they light, and the
 * dungeon reads flat.
 *
 * Four, because the longest ramp above any entry is the torch family's
 * 14→15→16→17→18. Fewer would make a flame core unreachable from an ember;
 * more would be dead texture, since every other ramp saturates in two or three.
 */
const SHADE_UP_ROWS = 4;

/** Texture height: the highlight rows, the material itself, then the shadow rows. */
const SHADE_TOTAL_ROWS = SHADE_UP_ROWS + 1 + SHADE_ROWS;

/**
 * The pre-baked shaded palette: PALETTE_SIZE wide, SHADE_TOTAL_ROWS tall.
 *
 * Row `SHADE_UP_ROWS` is the material itself. Rows above it are the entry walked
 * UP its own ramp (brightest first, at row 0); rows below are the entry walked
 * DOWN. So "row index increases with darkness" throughout, and the shader's row
 * search is one loop over the whole column.
 *
 * NearestFilter and NO colour-space decode: it holds the same sRGB bytes the
 * shader's min-reduction compares against, and letting three "helpfully" decode
 * it would put the lookup in a different space from the snap that chose it.
 */
function buildShadedPalette(palette: Float32Array): THREE.DataTexture {
  const n = Math.floor(palette.length / 3);
  // Built from the INJECTED one-step tables rather than imported from the game:
  // `engine/` may not depend on game content (engine-boundary.test.ts), and a
  // colour ramp is art direction. The walk is defined in render/palette-shading.
  const down = enginePalette.shadeDown?.() ?? new Uint8Array(n);
  // An IDENTITY fallback, not `i+1`: a palette with no up-ramp declared should
  // lose its highlights, not gain a walk into whatever entry happens to sit next
  // in the array. Losing them is a visible flatness; inventing them is the
  // cross-family bug this whole file exists to stop.
  const up = enginePalette.shadeUp?.() ?? Uint8Array.from({ length: n }, (_, i) => i);
  const rows = new Uint8Array(SHADE_TOTAL_ROWS * n);
  const ID = SHADE_UP_ROWS;
  for (let i = 0; i < n; i++) rows[ID * n + i] = i;
  for (let s = ID + 1; s < SHADE_TOTAL_ROWS; s++) {
    for (let i = 0; i < n; i++) rows[s * n + i] = down[rows[(s - 1) * n + i]] ?? 0;
  }
  for (let s = ID - 1; s >= 0; s--) {
    for (let i = 0; i < n; i++) rows[s * n + i] = up[rows[(s + 1) * n + i]] ?? i;
  }
  const data = new Uint8Array(n * SHADE_TOTAL_ROWS * 4);
  for (let s = 0; s < SHADE_TOTAL_ROWS; s++) {
    for (let i = 0; i < n; i++) {
      const src = rows[s * n + i];
      const o = (s * n + i) * 4;
      data[o] = Math.round(palette[src * 3] * 255);
      data[o + 1] = Math.round(palette[src * 3 + 1] * 255);
      data[o + 2] = Math.round(palette[src * 3 + 2] * 255);
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, n, SHADE_TOTAL_ROWS, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function finalNode(
  diffuse: THREE.Texture,
  albedoTex: THREE.Texture,
  bloomTex: THREE.Texture,
  depth: THREE.Texture,
  uiTex: THREE.Texture,
  palette: Float32Array,
  shadedPal: THREE.Texture,
  u: FinalUniforms,
): TSLNode {
  // Diffuse, depth and bloom are all render targets, so all three are sampled
  // through the same flipped UV — keeping AO/outline depth taps registered
  // with the colour they shade. Vignette and aberration are centre-symmetric,
  // and dither/scanlines are screen-space patterns; none care about v-flip.
  const vUv = rtUv();
  const res = u.resolution;

  /**
   * The WARPED scene coordinate. Every tap that reads the SCENE — colour, depth,
   * bloom — goes through this; every tap that draws a DISPLAY artefact (the
   * vignette's `q`, the dither's `screenCoordinate`, the scanline's row, and the
   * UI composite) deliberately does not.
   *
   * That split is the whole correctness story. The vignette is a lens and the
   * scanlines are a CRT: they live in front of the picture, not in it, so warping
   * them would wobble the monitor instead of the air. The UI is a 2D sheet
   * composited on top and must never move — see the note at the UI mix below.
   */
  const sceneUv = heatWarp(vUv, u, res);

  // Derived from the array actually handed in, not from a module constant: the
  // palette is injected by the game, so its size is only known here. The
  // unrolled snap below depends on this being the real count — a stale size
  // would either skip colours or read past the end of the array.
  const PALETTE_SIZE = Math.floor(palette.length / 3);

  // Depth sampling helper — matches `depthAt(texelOffset)` in the GLSL.
  const depthAt = (ox: number, oy: number): TSLNode =>
    texture(depth, sceneUv.add(vec2(ox, oy).div(res))).x;

  // ── Chromatic aberration: split R/B outward from centre. `uAberration = 0`
  // must reduce to EXACTLY the single-tap fetch, so it is a mix, not a scale.
  // ── FRENZY CHROMATIC ABERRATION, ON THE LIT BUFFER ────────────────────────
  //
  // It used to split the ALBEDO instead, and the reason was sound at the time:
  // while the screen-space palette snap was live it chose HUE from the albedo,
  // so a split of the lit buffer moved only the luma and the fringe vanished
  // into the snap. Correct then, exactly inverted now.
  //
  // The snap retired on 2026-08-03 (`QUANTIZE_DEFAULT = false`), and with it
  // the albedo stopped reaching the screen at all — `alb`'s only consumer is
  // the snap, whose result is `mix(..., u.quantize)` with quantize pinned to 0.
  // So the effect went on being computed, and ramped every rendered frame by
  // `setFrenzyFx`, while rendering NOTHING. Nobody had seen it in months.
  //
  // Measured back to life on the buffer that is actually presented. Same two
  // taps: they moved here from the albedo rather than being added, because a
  // split albedo is now the half that cannot be seen.
  const off = sceneUv.sub(0.5).mul(u.aberration);
  const plain = texture(diffuse, sceneUv).rgb;
  const split = vec3(
    texture(diffuse, sceneUv.add(off)).r,
    plain.g,
    texture(diffuse, sceneUv.sub(off)).b,
  );
  // Gated on the uniform rather than always mixing, so a frame with no combo
  // running pays nothing for the fringe beyond the two taps.
  let col: TSLNode = mix(plain, split, u.aberration.greaterThan(0.0001).select(float(1), float(0)));

  // ── THE ALBEDO TARGET — the material, before any light touched it.
  //
  // MRT attachment 1, written by every material as its `diffuseColor` (see
  // `sceneMrt` at the bottom of this file). This is what makes the pass
  // "indexed lighting" in the sense the design cites rather than in name only:
  // the FAMILY is chosen from what a surface IS, and every lighting term in the
  // game — the scene's own lights included — is spent as a walk along that
  // family's ramp.
  //
  // Measured, and this is the whole reason the attachment exists: snapping on
  // the lit buffer put 51.5% of (material x shading situation) pairs into a
  // family their albedo does not belong to (`render/light-crossing.ts`). Not
  // mostly from the torches' hue — from the sheer DARKENING. Ambient at 3.5
  // becomes a ~0.4x multiply after BRDF_Lambert, and this palette's eight
  // families are far enough apart that 0.4x relocates most of them. The cheap
  // fixes that were on the table (desaturate the torch, whiten it, raise the
  // ambient) each move that number by three to five points. There was nothing
  // cheaper to try.
  // NOT split — see the aberration note above. If the screen-space snap is ever
  // revived, the fringe has to move BACK here (and `col`'s split comes out),
  // because a snap that reads hue from a plain albedo would quantise the fringe
  // straight back out of the picture.
  const albPlain = texture(albedoTex, sceneUv).rgb;
  let alb: TSLNode = albPlain;

  // ── Screen-space AO from the (ortho ⇒ linear) depth buffer. A concave corner
  // has neighbours CLOSER than the centre; sample a ring at two radii and
  // darken by how many neighbours are moderately closer. Tiny diffs (flat
  // ground) and huge ones (a silhouette against the void) are both excluded,
  // so corners get AO without haloing every sprite.
  const c0 = depthAt(0, 0);
  let occ: TSLNode = float(0);
  for (let i = 0; i < 8; i++) {
    const a = i * 0.7853981634; // 2π / 8
    for (let r = 1; r <= 2; r++) {
      const rad = r === 1 ? 0.5 : 1.0;
      // uAoRadius is a uniform, so the offset must be built as nodes.
      const d = vec2(Math.cos(a) * rad, Math.sin(a) * rad).mul(u.aoRadius);
      const diff = c0.sub(texture(depth, sceneUv.add(d.div(res))).x);
      occ = occ.add(step(float(0.00015), diff).mul(float(1).sub(smoothstep(0.004, 0.02, diff))));
    }
  }
  // Void/sky (depth >= 0.999) is excluded — nothing there to occlude.
  const aoTerm = c0.greaterThanEqual(0.999).select(float(0), occ.div(16));
  // ⚠️ AO does NOT multiply the colour any more. Every multiplicative darkening
  // term in this shader accumulates into `light` and is spent at the quantizer
  // as a walk down the palette ROW — see the lookup at the snap. Multiplying
  // here is what made a shadowed floor change HUE: the darkened value snapped to
  // whichever family the luma-weighted metric happened to favour, and this
  // palette's eight families are far apart. Measured: 24 of 32 entries leave
  // their family before 0.35, and the tavern floor (28) leaves it at 0.95.
  let light: TSLNode = float(1).sub(aoTerm.mul(u.ao));

  // ── Bloom, added in LINEAR so bright torch cores bleed a warm halo.
  col = col.add(texture(bloomTex, sceneUv).rgb.mul(u.bloom));

  // ── Accurate linear → sRGB transfer (done by hand; see the file header).
  // BOTH buffers go through it: the palette is sRGB, and the snap now compares
  // the albedo against it while the row search compares the lit luma. Two
  // quantities in two different transfer functions would silently mis-rank the
  // rows — the lit side is a luma and the difference would read as "the shading
  // is a bit off", not as a colour-space bug.
  // step() is typed float-only, but GLSL step() is COMPONENTWISE on vec3 and
  // that is exactly what the original shader relied on for the per-channel
  // sRGB knee. The graph handles vec3 fine; only the .d.ts is narrow.
  const toSrgb = (c: TSLNode): TSLNode => {
    const lo: TSLNode = c.mul(12.92);
    const hi: TSLNode = pow(max(c, vec3(0, 0, 0)), vec3(1 / 2.4, 1 / 2.4, 1 / 2.4)).mul(1.055).sub(0.055);
    const knee: TSLNode = (step as TSLNode)(vec3(0.0031308, 0.0031308, 0.0031308), c);
    return mix(lo, hi, knee);
  };
  col = toSrgb(col);
  alb = toSrgb(alb);

  // ── Vignette, BEFORE the quantizer so the falloff snaps to darker steps.
  const q = vUv.sub(0.5);
  const vig = smoothstep(0.85, 0.32, dot(q, q).mul(2)); // 1 centre → 0 corners
  light = light.mul(mix(float(1), vig, u.vignette));

  // ── Ink outline — the cel-shading move. TWO edge terms, because a depth
  // edge alone is blind to the case that matters most.
  //
  // With an ORTHO camera the depth buffer is linear in eye space, so a fixed
  // depth threshold works and catches every silhouette that stands PROUD of
  // what is behind it. What it cannot see is a silhouette at the SAME depth:
  // an actor standing on the floor plane, a prop against a wall it is touching,
  // two monsters overlapping in the same rank. Those lose their edge entirely,
  // and the maze track's surface painter made it worse by putting a bright
  // flowstone wash under the rot-green horde — same depth, and after the
  // 32-colour snap very nearly the same colour.
  //
  // So the second term is a LUMA edge on the colour buffer. It is the cheap
  // stand-in for a palette-index edge: two neighbours that will quantize to
  // different entries differ in luma by roughly a palette step first, and one
  // dot product beats re-running the 32-way snap at four extra taps.
  //
  // The threshold is the whole design. Flagstone grout, the dither pattern and
  // the AO ring all produce luma steps around 0.05-0.12; a real material or
  // silhouette change is 0.25 and up. Under it the screen goes inky and the
  // pixel art turns to mud, which is the failure this term has to avoid more
  // than it has to catch every edge.
  // `c0` above is already `depthAt(0, 0)`; this used to fetch it a second time.
  const dc = c0;
  const e = max(
    max(depthAt(1, 0).sub(dc).abs(), depthAt(-1, 0).sub(dc).abs()),
    max(depthAt(0, 1).sub(dc).abs(), depthAt(0, -1).sub(dc).abs()),
  );
  // Sampled on the tone-mapped colour (a rough gamma via sqrt), not on linear:
  // linear luma is crushed at the dark end, and this dungeon is nearly all dark
  // end, so a linear threshold would fire on highlights and never on the
  // shadowed silhouettes that need it.
  const LUMA = vec3(0.3, 0.59, 0.11);
  // ── THE NEIGHBOUR TAPS READ THE ALBEDO, NOT THE LIT FRAME (2026-07-30) ──
  //
  // This term is a cheap stand-in for a PALETTE-INDEX edge: "will these two
  // pixels quantize to different entries?". Since the snap moved onto the albedo
  // the taps have to move with it, or the stand-in is measuring a quantity the
  // snap no longer reads.
  //
  // ⚠️ IT WAS NOT INKING SHADOW BOUNDARIES, and the plan that scheduled this
  // change said it was. Measured before touching anything: across four biomes
  // and every entry, the largest luma step ONE material can show across an
  // adjacent-pixel lighting boundary is 0.153 — a hard key-light shadow edge is
  // 0.136, a torch pool edge 0.153, a wall face against a wall top 0.076. All of
  // them are under the 0.26 threshold, and the false-edge rate is 0/120 in every
  // case. The threshold was already doing that job.
  //
  // The real defect is the opposite one: the darkening COMPRESSES material
  // contrast, so true silhouettes lose their ink. Of the cross-family material
  // boundaries that this term exists to catch, at threshold 0.26:
  //
  //     read on the lit frame     29.1% caught   (median step 0.161)
  //     read on the albedo        46.9% caught   (median step 0.243)
  //
  // Which is the complaint the block below already records — "an actor standing
  // on the floor plane, a prop against a wall it is touching… lose their edge
  // entirely" — arriving with a number and a cause.
  const nbTap = (ox: number, oy: number): TSLNode =>
    texture(albedoTex, sceneUv.add(vec2(ox, oy).div(res))).rgb;
  const nbs: TSLNode[] = [nbTap(1, 0), nbTap(-1, 0), nbTap(0, 1), nbTap(0, -1)];
  const lumaOf = (c: TSLNode): TSLNode => dot(sqrt(max(c, vec3(0, 0, 0))), LUMA);
  // The centre tap is the albedo's own, and it is `albPlain` rather than `alb`:
  // `alb` has the chromatic-aberration split folded in, and an edge detector that
  // saw the fringe would ink it. Both are LINEAR here — the sqrt below is this
  // term's own rough gamma, applied to whichever buffer it reads.
  const lc = lumaOf(albPlain);
  const le = max(
    max(lumaOf(nbs[0]).sub(lc).abs(), lumaOf(nbs[1]).sub(lc).abs()),
    max(lumaOf(nbs[2]).sub(lc).abs(), lumaOf(nbs[3]).sub(lc).abs()),
  );
  // Void/sky is excluded the same way the AO ring excludes it: the edge where
  // the level meets nothing is already the strongest depth edge on the screen,
  // and inking it twice just thickens it.
  // Comparisons yield bool nodes, which carry no arithmetic — every one is
  // `select`ed to 0/1 before it meets a multiply.
  const notVoid: TSLNode = dc.lessThan(0.999).select(float(1), float(0));
  // ── THE WARMTH GATE: no colour-edge ink INSIDE the warm family. ──
  //
  // The colour term exists for same-depth SILHOUETTES (an actor on the floor it
  // stands on). It cannot tell those from same-depth PATTERNING — and the first
  // creature authored out of the torch ramp (the stiltneck, 2026-07-29) showed
  // the failure at full size: its giraffe blotches are ~0.47 luma steps, so
  // every spot, mane and strap boundary got the 0.45× ink and the monster read
  // as noise. Measured in a seeded A/B, this term was the largest remaining
  // source of its in-game mangling after the art itself was fixed.
  //
  // The fix keys on what a silhouette IS: a boundary between the figure and a
  // room that is not the figure's colour. This dungeon's environment is cold —
  // stone, steel, rot — so a neighbourhood where the centre AND all four taps
  // sit in the warm arc (r ≥ g: torch/skin/leather/blood; rot green fails it
  // because green dominates) can only be the INSIDE of something warm, and its
  // luma steps are highlights or markings, not edges. Any true silhouette
  // includes at least one cold tap, so it keeps its ink automatically — which
  // is also why the zombie-on-flowstone case this term was built for is
  // untouched: rot-on-rot is not warm-on-warm under r ≥ g.
  //
  // In LINEAR on purpose: r ≥ g survives any monotone per-channel transfer, so
  // gating before the sqrt costs nothing and reads the taps already fetched.
  //
  // ⚠️ AND ON THE ALBEDO, WHICH IS WHAT MAKES THE PREMISE TRUE AGAIN. "This
  // dungeon's environment is cold" is a claim about MATERIALS, and it was being
  // tested against LIT pixels — so a warm light made cold things warm and the
  // gate suppressed ink it had no business suppressing. Measured over the four
  // biomes with a torch in range: 81 of 120 entries read as warm on the lit
  // frame, including **Cold Crypt stone**, against 64 of 120 on the albedo. The
  // gate was quietly switching itself off across a third of the palette in
  // torchlight, and its own justification says it must not.
  const warmOf = (c: TSLNode): TSLNode => (step as TSLNode)(c.g, c.r);
  const allWarm: TSLNode = warmOf(albPlain)
    .mul(warmOf(nbs[0]))
    .mul(warmOf(nbs[1]))
    .mul(warmOf(nbs[2]))
    .mul(warmOf(nbs[3]));
  const colourEdge: TSLNode = le.greaterThan(u.edgeThreshold).select(float(1), float(0))
    .mul(notVoid)
    .mul(u.colourOutline)
    .mul(float(1).sub(allWarm));
  const depthEdge: TSLNode = e.greaterThan(float(0.35 / 200)).select(float(1), float(0));
  const inked = max(depthEdge, colourEdge).greaterThan(float(0.5)).select(float(0.45), float(1));
  // The outline is darkening too, so it rides `light` with everything else —
  // and this is a bonus rather than a compromise: driving a pixel hard down its
  // own ramp lands it on ink at the bottom, which is exactly what an ink outline
  // is. It can no longer produce a dark version of some OTHER material.
  light = light.mul(mix(float(1), inked, u.outline));

  // ── The in-game UI, composited HERE and nowhere else.
  //
  // This position is the whole design of the in-game UI, so it is worth being
  // explicit about both neighbours:
  //
  // AFTER the ink outline (and therefore after AO), because both of those read
  // the DEPTH texture. The UI is a flat 2D layer with no geometry and writes no
  // depth, so an outline pass that ran after it would ink the SCENE BEHIND the
  // menu straight through the sheet — edges of walls crawling across a paused
  // inventory screen. Sitting downstream of the depth-driven passes means the
  // UI simply cannot interact with them.
  //
  // BEFORE dither → palette snap → scanlines, because that is the entire point:
  // the menu snaps to the same 32 colours and wears the same scanlines as the
  // art, instead of floating above the game as un-quantized DOM did.
  //
  // COLOUR: `col` has already been through the hand-written linear→sRGB
  // transfer above, and canvas2D authors in sRGB, so this is a like-for-like
  // blend with no conversion. The texture MUST be tagged LinearSRGBColorSpace
  // by the caller so three does not "helpfully" decode it — see gui/layer.ts.
  //
  // UV: plain `uv()`, NOT the `rtUv()` every other sample in this shader uses.
  //
  // That looks inconsistent and is the opposite — it is the same rule applied
  // honestly. This file's model is ONE V-FLIP PER RENDER-TARGET HOP: the node
  // renderer flips render targets, so every RT sample here compensates with
  // `rtUv()`. The UI layer is not a render target. It is an UPLOADED canvas
  // texture, which has taken zero RT hops, so it needs zero compensation.
  //
  // MEASURED, not reasoned (2026-07-28). With `rtUv()` the probe's cyan left-
  // edge bar appeared correctly while its top-left gold block landed at the
  // BOTTOM — where the DOM HUD happened to cover it, so the frame looked
  // simply "empty" rather than "upside down". That is the exact trap this repo
  // fell into twice before: symmetric or occluded content hides a flip. Judge
  // this with `__gui.probe()` and check the GOLD BLOCK, never a centred menu.
  const uiTexel: TSLNode = texture(uiTex, uv());
  col = mix(col, uiTexel.rgb, uiTexel.a.mul(u.ui));
  // ⚠️ AND INTO THE ALBEDO. The snap chooses the family from `alb`, so a menu
  // that was only mixed into `col` would be drawn in the material of whatever
  // scene it happens to cover: a gold label over a blood wall would snap to
  // blood and merely be brighter. The UI's own canvas colours ARE its albedo —
  // it is an unlit 2D sheet — so this is the same mix, not a correction to it.
  alb = mix(alb, uiTexel.rgb, uiTexel.a.mul(u.ui));
  // The UI is not IN the world, so it must not be lit by it. An opaque menu
  // pixel is forced back to full light, or the corners of a paused inventory
  // would dim under the vignette that happens to be behind them.
  light = mix(light, float(1), uiTexel.a.mul(u.ui));

  // ── Full-screen flash BEFORE dither/quantize, so the wash snaps to the
  // palette's bright ramp like everything else. Into the albedo as well, for
  // the same reason as the UI: a flash that only raised the lit luma would walk
  // each material to its OWN highlight and the screen would go pastel-coloured
  // rather than white.
  col = mix(col, vec3(1, 1, 1), u.flash);
  alb = mix(alb, vec3(1, 1, 1), u.flash);

  // ── Bayer 4x4 ordered dither. Nudges each pixel up/down the ramp before the
  // snap, buying back apparent colour depth so gradients don't band.
  // screenCoordinate is the TSL equivalent of gl_FragCoord.xy.
  const fc = screenCoordinate;
  const bayer2 = (v: TSLNode): TSLNode => {
    const a: TSLNode = floor(v);
    return fract(a.x.div(2).add(a.y.mul(a.y).mul(0.75)));
  };
  const b = bayer2(fc.mul(0.5)).mul(0.25).add(bayer2(fc)).sub(0.5);
  // AMPLITUDE 1/PALETTE_SIZE, halved from 2/ on 2026-07-30 and A/B'd in-game.
  // The old width assumed evenly spaced palette steps; this palette's ramps
  // are close WITHIN a family and far BETWEEN families, so a full-step nudge
  // regularly pushed lit floor pixels across a family boundary and the whole
  // frame wore per-pixel confetti (the "colors are off" look). Half a step
  // still breaks AO/lighting banding — gradients dither at ramp boundaries —
  // but can no longer hop families from a standing start.
  // ⚠️ THE DITHER NO LONGER TOUCHES THE COLOUR — it is applied to the target
  // LUMA at the quantizer instead, where it can only move a pixel between two
  // rungs of its OWN ramp. Nudging the colour before a material snap moves it in
  // a space whose neighbours are other MATERIALS, which is what wore the frame
  // in per-pixel confetti and forced the amplitude down to half a step on
  // 2026-07-30 — and that halving is what then exposed the lighting banding.
  // Dithering in the right space removes the trade entirely.

  // ── Snap to the nearest palette entry, luma-weighted. Unrolled over the 32
  // colours: the palette is a compile-time constant here, so this becomes a
  // flat min-reduction with no uniform array indexing.
  //
  // Entry 0 seeds the reduction instead of a 1e9 sentinel: the first iteration
  // could never lose against 1e9, so its compare and two selects were dead work.
  //
  // ⚠️ DO NOT fold the luma weight into the palette to save the per-entry
  // multiply. It looks free — the palette is a compile-time constant, so
  // `pc * w` would fold at graph-build time and `col * w` is loop-invariant,
  // removing 96 multiplies per pixel. It is not free: `(a-b)*w` and `a*w - b*w`
  // round differently in the last place, and that flips the winner on 12 of the
  // 496 exact midpoints between palette pairs (measured — see
  // palette-snap.test.ts). A random sample of 200,000 colours finds ZERO
  // disagreements, which is exactly how this would have shipped. Ties are not
  // rare here either: the ordered dither above deliberately nudges colours to
  // sit BETWEEN two entries, so near-ties are the design, not an edge case.
  //
  // ⚠️ IT RUNS ON `alb`, NOT ON `col`. That one substitution is this pass's
  // whole colour correctness — see the albedo tap above for the number.
  let best: TSLNode = vec3(palette[0], palette[1], palette[2]);
  const d0 = alb.sub(best).mul(vec3(0.3, 0.59, 0.11));
  let bestDist: TSLNode = dot(d0, d0);
  let bestIdx: TSLNode = float(0);
  for (let i = 1; i < PALETTE_SIZE; i++) {
    const pc = vec3(palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2]);
    const d = alb.sub(pc).mul(vec3(0.3, 0.59, 0.11));
    const dist = dot(d, d);
    const closer = dist.lessThan(bestDist);
    best = closer.select(pc, best);
    bestDist = closer.select(dist, bestDist);
    // The winning INDEX, carried alongside the winning colour. A colour cannot
    // be walked down a ramp; only an index can.
    bestIdx = closer.select(float(i), bestIdx);
  }

  // ── INDEXED LIGHTING ───────────────────────────────────────────────────────
  //
  // The reduction above ran BEFORE this pass's own darkening terms, so `bestIdx`
  // is the material as lit — stone, rot, leather — chosen before AO, the
  // vignette or the ink outline could drag it into a neighbouring family.
  // Lighting is then spent by walking that entry down its own ramp, via the
  // pre-baked shaded-palette texture (row s = entry shaded s steps; see
  // render/palette-shading.ts, where the walk is defined and tested in plain
  // node).
  //
  // The reduction above ran on the ALBEDO, so `bestIdx` is the material itself —
  // stone, rot, leather — and NO lighting term can move it. That was not true
  // until 2026-07-30: the snap read the lit buffer, so the scene's own three.js
  // lighting (coloured ambient at 3.5, hemi, the cold key light, six
  // flame-orange torch PointLights at intensity 6) chose the family before AO,
  // the vignette or the ink outline ever got a say. BLUEPRINT.md records the
  // extreme version — torches at intensity 18 turned the cold crypt into a cosy
  // burrow — but the ordinary version was already 51.5% of the palette.
  //
  // ⚠️ THE ROW IS CHOSEN BY MATCHING LUMA, NOT BY SCALING THE SHADE AMOUNT.
  // That distinction is the whole reason the first attempt at this failed. A
  // linear map (`row = shade * ROWS`) puts most of the frame on row 0 — AO only
  // fires in corners and the vignette only at the edges — so the scene rendered
  // at full unshaded brightness and the dungeon went from cold blue-green to
  // bright grey-brown. Matching luma is SELF-CALIBRATING instead: the target is
  // what the old multiply would have produced, and the ramp rung nearest that
  // target is chosen, so the frame's brightness tracks the multiply as closely
  // as the material's own ramp allows. No constant to tune.
  const LUMA_W = vec3(0.3, 0.59, 0.11);
  // ── THE TARGET IS THE LIT LUMA, AND THAT IS THE OTHER HALF OF THE FIX.
  //
  // It used to be `luma(best) * light` — the luma of the SNAPPED colour, which
  // was itself chosen from the lit buffer, so the scene's lighting reached the
  // row search only by having already bent the family. Reading `col` directly
  // makes the split honest: `alb` says WHICH ramp, `col` says HOW FAR ALONG it,
  // and every light in the game — the three.js rig, the bloom halo, AO, the
  // vignette, the ink outline — arrives as one scalar on one axis.
  //
  // The bloom is the free win here. It is still added in linear BEFORE this, as
  // it must be, but it can no longer push a neighbouring pixel into the torch
  // family: it raises the lit luma, which walks the pixel UP its own ramp.
  // `MAZE_COLOUR_PLAN.md` wanted the bloom moved after the snap to get that;
  // moving it there would have broken the pass's central invariant (every
  // presented pixel IS a palette entry), and it turns out not to be necessary.
  //
  // Dither the TARGET, where a nudge can only move a pixel between two rungs of
  // its own ramp. 0.03 is roughly half a typical ramp step in luma.
  const target = dot(col, LUMA_W).mul(light).add(b.mul(0.03).mul(u.dither));
  // The row search now spans HIGHLIGHTS as well as shadows — see SHADE_UP_ROWS.
  let shaded: TSLNode = texture(shadedPal, vec2(bestIdx.add(0.5).div(PALETTE_SIZE), float(0.5).div(SHADE_TOTAL_ROWS))).rgb;
  let bestGap: TSLNode = dot(shaded, LUMA_W).sub(target).abs();
  for (let s = 1; s < SHADE_TOTAL_ROWS; s++) {
    const rowRgb = texture(shadedPal, vec2(bestIdx.add(0.5).div(PALETTE_SIZE), float(s + 0.5).div(SHADE_TOTAL_ROWS))).rgb;
    const gap = dot(rowRgb, LUMA_W).sub(target).abs();
    const nearer = gap.lessThan(bestGap);
    shaded = nearer.select(rowRgb, shaded);
    bestGap = nearer.select(gap, bestGap);
  }
  // ── THE CEL GRADE — what bands the frame now that the snap is retired.
  //
  // Runs on the LIT colour, after every darkening term has landed in `light`,
  // and it is the LAST thing before the scanlines because it has to see the
  // final pixel: posterizing before AO or the vignette would just have those
  // gradients smeared back across the bands it drew.
  //
  // 1. POSTERIZE. Round the luma to `celSteps` rungs and rescale the pixel's own
  //    RGB onto the rounded value. Chroma rides along untouched, so a torch pool
  //    stays orange and a rot floor stays green — the grade can brighten or
  //    darken a pixel but it can never move it to another material, which is the
  //    one thing the screen-wide palette snap could not promise.
  //    `max(lum, 1e-4)` guards the rescale: a pure-black pixel has no direction
  //    to be scaled along, and 0/0 would present as NaN — which the node
  //    renderer paints as black anyway, but only by luck.
  //
  //    ⚠️ THE RUNGS ARE SPACED ON A CURVE, NOT EVENLY (2026-08-03). Evenly is
  //    what made the map grainy, and it is worth being precise about the
  //    mechanism because "posterize looks blocky" is not the failure. With
  //    `celSteps = 10` spaced evenly across 0..1, the FIRST rung is luma 0.1 —
  //    so every pixel dimmer than 0.05 is crushed to PURE BLACK. This dungeon
  //    lives almost entirely under 0.35, and the flagstone painter puts
  //    single-pixel speckle one palette step apart (build.ts `makeFloorTexture`),
  //    so that boundary runs straight through the floor texture. Measured on the
  //    Bloodworks masonry (11/12 side by side) across the lighting range a
  //    torch-lit floor actually spans:
  //
  //                        speckle crushed to black   worst pair amplification
  //      even rungs              11% of the range     ∞  (one side IS black)
  //      curve 0.5                0% of the range     1.41x
  //
  //    A neighbour pair the art drew at 1.59:1 was being presented at ∞:1 on a
  //    ninth of the floor. That is the "grain" — not the banding, the CRUSH.
  //
  //    `celCurve` is the exponent the luma is banded in: rungs land at
  //    `(k/steps)^(1/curve)`, so 0.5 puts six of eleven rungs under luma 0.35
  //    (evenly spaced puts four, three of which the scene never reaches) and the
  //    absolute step SHRINKS toward black instead of staying a flat 0.1. Bands
  //    stay bold where the light is, which is where cel shading is supposed to
  //    be bold, and go subtle in shadow, where a hard step reads as dirt.
  //    `curve = 1` is exactly the old even spacing, for an A/B.
  // 2. SATURATE. Push the result away from its own grey. `clamp` after, so an
  //    already-vivid pixel flattens to the primary instead of wrapping.
  const litCol = col.mul(light);
  const CEL_LUMA = vec3(0.2126, 0.7152, 0.0722);
  const lum = max(dot(litCol, CEL_LUMA), float(0.0001));
  const curved = pow(lum, u.celCurve);
  const bandedCurved = floor(curved.mul(u.celSteps).add(0.5)).div(u.celSteps);
  // Back out of the curve. `max(…, 1e-6)` because `pow(0, 1/curve)` is 0/0-shaped
  // on some backends: rung 0 must be black, not NaN.
  const banded = pow(max(bandedCurved, float(0.000001)), float(1).div(u.celCurve));
  const posterized = litCol.mul(banded.div(lum));
  const grey = dot(posterized, CEL_LUMA);
  const celCol = mix(vec3(grey, grey, grey), posterized, u.celSaturation).clamp(0, 1);

  col = mix(mix(litCol, celCol, u.cel), shaded, u.quantize);

  // ── Scanlines: every other ROW of the render target, dimmed.
  const line: TSLNode = mod(floor(vUv.y.mul(res.y)), 2);
  col = col.mul(mix(float(1), mix(float(1), float(0.86), line), u.scanline));

  return vec4(col, 1);
}

/** The result of one sizing pass. Pure data — safe to compute without a GL context. */
export interface RenderSizing {
  /** Whole-number upscale: one render pixel is exactly this many screen pixels square. */
  scale: number;
  /** Render-target width, always EVEN. */
  renderW: number;
  /** Render-target height, always EVEN. */
  renderH: number;
  /** Canvas drawing-buffer width  = renderW * scale, in DEVICE pixels. */
  outW: number;
  /** Canvas drawing-buffer height = renderH * scale, in DEVICE pixels. */
  outH: number;
  /**
   * CSS pixels per render pixel = `scale / browserZoom`.
   *
   * The canvas is laid out in CSS pixels and drawn in device pixels, and under
   * browser zoom those are not the same unit. This is the one number that
   * converts between them, and EVERYTHING that maps a pointer or sizes the
   * element must use it rather than `scale` — see `cancelBrowserZoom` below.
   */
  cssScale: number;
  /**
   * The browser-zoom factor this sizing was computed against.
   *
   * NOT necessarily 1 at page load — a page opened at 80% zoom starts at 0.8,
   * which is the whole point: the load-time zoom has to be divided back out too,
   * or the field of view depends on what the zoom happened to be when you hit
   * reload. See `cancelBrowserZoom`.
   */
  browserZoom: number;
  /** True when MAX_RENDER_* clamped the target, so outW/outH no longer cover the window. */
  capped: boolean;
}

/**
 * ── BROWSER ZOOM MUST NOT CHANGE THE GAME ──
 *
 * Ctrl +/- changes `window.innerWidth` (CSS px) and `devicePixelRatio` by
 * reciprocal amounts; the window's PHYSICAL size does not move. Sizing off
 * `innerWidth` alone therefore reads a zoom as a resize, and the game responds
 * by re-deriving everything from it: the frustum widens or narrows (so you see
 * more or less of the level), and the UI's integer design zoom steps (so the
 * HUD abruptly halves or doubles). Neither is what a player means by "zoom in".
 *
 * Measured on a 1920x1080 monitor before this: 90% zoom put the game in a
 * letterbox with 106px bars, and 125% dropped the HUD from 167 to 95 device
 * pixels in one keypress.
 *
 * So the zoom is CANCELLED. `devicePixelRatio` is compared against the value at
 * page load and the ratio is divided back out of the window size, which makes
 * the render grid — and therefore the field of view, the UI zoom, and every
 * layout in the game — invariant under ctrl +/-. What zoom still does is the
 * thing it should: the same frame is presented across more or fewer physical
 * pixels, so the picture gets sharper or softer, never differently composed.
 *
 * ── WHY THE BASELINE IS NOT THE RAW dpr, AND NOT THE dpr AT LOAD EITHER ──
 * `devicePixelRatio` is ALSO 2 on a Retina panel at 100% zoom. Treating the raw
 * value as zoom would quadruple the render target on every HiDPI laptop — the
 * opposite of the "fat honest pixels, dpr deliberately ignored" decision this
 * file makes on purpose. So the zoom has to be measured against a baseline.
 *
 * That baseline used to be simply `devicePixelRatio` AT PAGE LOAD, with the note
 * that a page loaded already-zoomed "bakes that in and is then stable, which is
 * the right failure: consistent, and it cannot drift mid-session". It is not
 * consistent, and this is the bug behind "why does the resolution keep changing"
 * (2026-07-30). Only the zoom SINCE LOAD was cancelled, so the load-time zoom
 * still went straight into the grid — and the field of view with it. Measured on
 * one physical 1872x932 window at the `wider` rung, varying only the zoom the
 * page was LOADED at:
 *
 *     loaded at   CSS window   grid        tiles across   drawing buffer
 *      100%       1872x932     1872x932        33.4          1.7 Mpx
 *       80%       2340x1165    1170x584        20.9          2.7 Mpx   -37%
 *       67%       2794x1391    1398x696        25.0          3.9 Mpx
 *       50%       3744x1864    1872x932        33.4          7.0 Mpx
 *       33%       5673x2824    1892x942        33.8         16.0 Mpx
 *       25%       7488x3728    1498x746        26.8         27.9 Mpx
 *       20%       9360x4660    1560x778        27.9         43.7 Mpx
 *
 * Non-monotonic, up to 37% tighter than 100%, and the buffer runs away at the
 * far end because `scale` climbs to cover a CSS window that is not physically
 * there. And the CAMERA row in the settings screen offers a RELOAD button, so
 * the one control that exists to fix the zoom was also the thing that rerolled
 * it. The old guard made it worse still: `z > 0.2` EXCLUDES exactly 20%, which
 * is a real Vivaldi zoom step, so at that one level cancellation switched itself
 * off entirely and the game sized off a 9360px window.
 *
 * The baseline is now the dpr this page WOULD have at 100% zoom, derived by
 * dividing out the zoom it was loaded at. `outerWidth / innerWidth` is what
 * reveals that: page zoom moves `innerWidth` (CSS px of the viewport) and leaves
 * `outerWidth` (the OS window) alone, so their ratio IS the zoom, up to a few
 * pixels of window border. Snapping to the rungs a browser actually offers
 * removes that noise — see `snapZoomStep`.
 */

/**
 * The zoom levels a desktop browser actually offers, smallest first. Chrome
 * bottoms out at 25%; Vivaldi goes to 20%, which is where this was reported.
 *
 * A closed set is what makes the `outerWidth / innerWidth` measurement usable:
 * the ratio carries a few pixels of window-border noise, but the rungs are 10%
 * apart at the tightest, so the nearest one is unambiguous.
 */
const ZOOM_STEPS = [0.2, 0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

/**
 * How close to a rung the measured ratio has to be, in log space, before it is
 * believed. 2%.
 *
 * ── WHY IT IS THIS TIGHT, MEASURED NOT GUESSED ──
 * The two ways to be wrong here are NOT symmetric. Reject a real zoom and the
 * baseline falls back to raw dpr, which is exactly the behaviour that shipped
 * before this function existed — no worse than before. Accept a ratio that is
 * not a zoom and the game invents one, resizing the grid for a window that is
 * not there — strictly worse than before. So the bar is set to make the second
 * mistake hard, and the tolerance is derived from real numbers rather than from
 * the gaps between rungs:
 *
 *     window                          outer/inner   nearest rung   log err
 *     real Chrome window, 100%        1712/1696       1            0.0094  ✔
 *     the same under CDP viewport
 *       emulation (1600 override)     1712/1600       1.1          0.0276  ✘
 *
 * That second row is this repo's OWN screenshot harness (`scripts/ui-probe.mjs`
 * and every playwright test): Playwright overrides `innerWidth` and leaves
 * `outerWidth` on the real browser window, so the ratio is meaningless. At the
 * 5% tolerance the gaps between rungs would have allowed, 1.07 reads as "110%
 * zoom" and every headless shot silently renders 10% more level than the game.
 * The first row's 16px of window border is 0.94%, so 2% clears the real case
 * with margin and rejects the emulated one.
 *
 * The cost is that a genuine zoom on a NARROW window can fall below the bar —
 * 16px of border is 3.2% of a 500px viewport — and there the baseline degrades
 * to dpr-at-load. That is the safe direction.
 */
const ZOOM_SNAP_TOLERANCE = 0.02;

/**
 * Nearest browser zoom rung to `ratio`, or 1 if it is not near any of them.
 *
 * Distance is measured in LOG space because the rungs are multiplicative — 0.2
 * and 0.25 are 0.05 apart in absolute terms and would lose every tie to the
 * dense cluster around 1. Falling back to 1 rather than to the raw ratio is
 * deliberate: an unrecognised ratio means the measurement is not measuring zoom
 * (an iframe, where `outerWidth` belongs to a different window; a headless
 * context where it is 0 or where the viewport has been overridden), and 1 is the
 * old behaviour.
 */
export function snapZoomStep(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 1;
  let best = 1;
  let bestErr = Infinity;
  for (const s of ZOOM_STEPS) {
    const err = Math.abs(Math.log(ratio / s));
    if (err < bestErr) {
      bestErr = err;
      best = s;
    }
  }
  return bestErr <= ZOOM_SNAP_TOLERANCE ? best : 1;
}

/**
 * The `devicePixelRatio` this page would report at 100% zoom.
 *
 * Pure, and takes its three inputs rather than reading `window`, so a test can
 * drive it with a real browser's numbers. `cancelBrowserZoom` is the only thing
 * that touches `window`; everything a test needs to pin lives in here.
 */
export function zoomBaseline(dpr: number, outerW: number, innerW: number): number {
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  if (!Number.isFinite(outerW) || !Number.isFinite(innerW) || outerW <= 0 || innerW <= 0) return d;
  return d / snapZoomStep(outerW / innerW);
}

/** The live zoom factor: current dpr against the 100%-zoom baseline. */
export function browserZoom(dpr: number, baseline: number): number {
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const z = d / baseline;
  // Guard against a nonsense ratio from a display hot-swap: a wild value here
  // would resize the render target rather than merely look wrong. The floor is
  // 0.1, BELOW the tightest zoom any browser offers — the old `> 0.2` sat ON a
  // real rung and disabled cancellation at exactly the level it was needed.
  return Number.isFinite(z) && z >= 0.1 && z <= 8 ? z : 1;
}

const BASE_DPR =
  typeof window === "undefined" ? 1 : zoomBaseline(window.devicePixelRatio || 1, window.outerWidth, window.innerWidth);

export function cancelBrowserZoom(): number {
  if (typeof window === "undefined") return 1;
  return browserZoom(window.devicePixelRatio || 1, BASE_DPR);
}

/** Round UP to the next even number. */
function evenCeil(v: number): number {
  return 2 * Math.ceil(v / 2);
}

/**
 * ADAPTIVE INTEGER RENDER SIZE — the fix for the game-wide mush.
 *
 * WHAT IT USED TO DO. The render target was a fixed 1280x720 and `resize()`
 * blitted it at a FRACTIONAL scale (`INTEGER_SCALE = false`):
 *   scale = min(winW / 1280, winH / 720);  outW = round(1280 * scale)
 * On a 1920x1080 window that is x1.5. With nearest-neighbour display (which is
 * what `image-rendering: pixelated` gives you) a x1.5 upscale makes every
 * render pixel alternately 1 or 2 screen pixels wide, in a fixed comb across
 * the whole screen. Every sprite, prop and tile inherits it simultaneously,
 * which is why it read as "the game is blurry" rather than as a bug in any one
 * asset. The comment that justified it — "cel art scales cleanly (it's smooth
 * shapes, not a pixel grid)" — was stale: the pipeline now crushes everything
 * to a hard pixel grid, so the premise no longer held.
 *
 * WHAT IT DOES NOW. Instead of a fixed target scaled by a fraction, we derive
 * the target from the window so the upscale is always a WHOLE number and the
 * image still fills the screen with no letterbox bars:
 *   scale   = smallest s >= 1 with evenCeil(winW / s) <= MAX_RENDER_W
 *                             and evenCeil(winH / s) <= MAX_RENDER_H
 *   renderW = evenCeil(winW / scale)   ⇒  renderW * scale >= winW
 * MAX_RENDER_* is the CEILING on how much level a window may reveal, and it is
 * the only thing that picks the zoom. RENDER_W/RENDER_H are the FLOOR: the
 * bump is not allowed to take the grid under them (MIN_BUMP_*), so the player
 * never sees less of the level than 1280x720 was showing. Between the two they
 * see as much as the ceiling allows — that is the unavoidable shape of integer
 * scale + no letterbox + fixed PPU.
 *
 * The zoom used to be chosen against the FLOOR instead —
 * `floor(min(winW / RENDER_W, winH / RENDER_H))`, the biggest zoom the window
 * could carry — which pinned every exact multiple of the reference AT the
 * reference. A 2560x1440 monitor therefore rendered 1280x720 at x2, 22.9 tiles
 * across, where the 1920x1080 monitor beside it rendered 1920x1080 at x1 and
 * got 34.3. See MAX_RENDER_W in constants/render.ts for the measured table.
 *
 * WHY EVEN. An ODD render width puts the orthographic frustum's centre on a
 * half-texel: `left = -renderW / (2 * PPU)` is then a half-pixel offset, and
 * EVERY sprite in the scene inherits that half-pixel shift and samples between
 * texels. Rounding up to even costs at most one render pixel and keeps the
 * frustum centre exactly on the grid.
 *
 * WHY A CAP. Without one, `scale` would simply be 1 and the target would be
 * the window — a 7680x1080 ultrawide would ask for a 7680-wide target, and
 * every big monitor would reveal an unbounded amount of level. MAX_RENDER_*
 * bounds both; when it bites we KEEP the integer scale and letterbox rather
 * than fall back to a fractional upscale — crispness is the invariant.
 */
export function computeRenderSizing(winW: number, winH: number, zoom = 1): RenderSizing {
  // The window in ZOOM-CANCELLED pixels — see `cancelBrowserZoom`. `winW * zoom`
  // is the PHYSICAL viewport, in the units it would have at 100% zoom, whatever
  // the zoom is now and whatever it was when the page loaded. So every number
  // derived below is invariant under ctrl +/- AND under a reload while zoomed.
  const w = Math.max(1, Math.floor(winW * zoom));
  const h = Math.max(1, Math.floor(winH * zoom));

  // ── THE UPSCALE IS THE SMALLEST ONE THAT FITS, NOT THE LARGEST (2026-08-29) ──
  //
  // This was `floor(min(w / RENDER_W, h / RENDER_H))` — the BIGGEST whole-number
  // zoom the window could carry while still showing the 1280x720 reference.
  // That reads as "as chunky as the window allows", and it pins the grid AT the
  // reference — i.e. at the MINIMUM field of view — for every window that is a
  // multiple of it. A 2560x1440 monitor got a 1280x720 grid, 22.9 tiles across,
  // where the 1920x1080 monitor beside it got 34.3. See MAX_RENDER_W for the
  // measured table and the report it came from.
  //
  // MAX_RENDER_* is the thing that actually decides how much level a window may
  // reveal, and it says so in grid pixels. So let it be the ONLY thing that
  // decides: start at x1 (grid = window — the most level, and the crispest
  // presentation this design can give) and climb only as far as the ceiling
  // forces. Every window at or under the ceiling is untouched — 1280x720,
  // 1366x768 and 1920x1080 all still render x1, pixel for pixel.
  const baseScale = 1;

  // ── THE FLOOR IS GONE, AND ON PURPOSE (2026-07-29) ──
  //
  // There used to be a FLOOR at the 1280x720 reference, justified as "the
  // minimum logical resolution is a design guarantee": below it the canvas was
  // deliberately LARGER than the window and allowed to overflow, so the player
  // never saw less than the designed field of view.
  //
  // That guarantee shipped a bug. The canvas is CENTRED (see `resize`), so an
  // oversized one gets a NEGATIVE `top` — and the HUD is anchored to the
  // frame's bottom edge, not the viewport's, so it slides straight out of the
  // window. Measured on a 1920x1080 screen:
  //
  //     browser zoom   CSS window   canvas      top    HUD
  //     150%           1280x720     1280x720      0    fine
  //     175%           1097x617     1280x720    -52    bottom 52px cut
  //     200%            960x540     1280x720    -90    GONE
  //
  // The same arithmetic applies to any window shorter than 720 CSS px, browser
  // zoom or not. Seeing slightly less of the level is a compromise; a HUD you
  // cannot see is a broken game, so the target now tracks the window and the
  // canvas always fits inside it.
  //
  // ── THE CEILING RAISES THE SCALE, IT DOES NOT LETTERBOX ──
  //
  // MAX_RENDER_* stops a very wide window asking for a runaway target. Clamping
  // the GRID alone was the wrong way to enforce it, because `scale` had already
  // been chosen against the unclamped size: `out = renderW * scale` then came
  // out SMALLER than the window and the difference showed as black bars.
  //
  // Measured on a 1920x1080 monitor, which is where it bites hardest — one
  // press of ctrl+- from 100%:
  //
  //     browser zoom   CSS window   scale   grid        out         bars
  //     100%           1920x1080      1     1920x1080   1920x1080   none
  //      90%           2133x1200      1     1920x1080   1920x1080   106 x 60
  //      80%           2400x1350      1     1920x1080   1920x1080   240 x 135
  //      75%           2560x1440      2     1280x720    2560x1440   none
  //
  // So the ENTIRE 1921..2559 x 1081..1439 band — every zoom step between 75%
  // and 100% — played in a letterboxed window, and the two steps either side of
  // it did not. That reads as the game breaking when you zoom, which is exactly
  // what it was reported as.
  //
  // Raising `scale` instead is the fix, and it is the same trade the rest of
  // this function already makes: a bigger upscale means a smaller grid, which
  // means slightly less of the level on screen — a compromise — where bars are
  // a defect. The loop terminates because every increment divides `want` down
  // and MAX_RENDER_* are both well above RENDER_*.
  // The bump is only allowed while the grid it produces is still a PLAYABLE
  // resolution. On a 7680x1080 ultrawide, chasing the ceiling with scale alone
  // reaches 1920x270 — four tiles of vertical view, which fills the window and
  // is unplayable. There, bars are the right answer and the clamp below takes
  // over; that is what MAX_RENDER_* was for in the first place.
  let scale = baseScale;
  let renderW = evenCeil(w / scale);
  let renderH = evenCeil(h / scale);
  while ((renderW > MAX_RENDER_W || renderH > MAX_RENDER_H) && scale < MAX_SCALE) {
    const nextScale = scale + 1;
    const nextW = evenCeil(w / nextScale);
    const nextH = evenCeil(h / nextScale);
    if (nextW < MIN_BUMP_W || nextH < MIN_BUMP_H) break;
    scale = nextScale;
    renderW = nextW;
    renderH = nextH;
  }
  // Only if even MAX_SCALE could not get under the ceiling — a window wider
  // than MAX_RENDER_W * MAX_SCALE — do we clamp and accept the bars. Nothing
  // real reaches this; it exists so the return is always well-formed.
  const cappedW = Math.min(renderW, MAX_RENDER_W);
  const cappedH = Math.min(renderH, MAX_RENDER_H);

  return {
    scale,
    renderW: cappedW,
    renderH: cappedH,
    outW: cappedW * scale,
    outH: cappedH * scale,
    cssScale: scale / zoom,
    browserZoom: zoom,
    capped: cappedW < renderW || cappedH < renderH,
  };
}

/**
 * The most an upscale is ever allowed to grow while chasing MAX_RENDER_*.
 *
 * A backstop, not a tuning knob: at scale 8 a 1920-wide grid would need a
 * 15360px window. It exists so the loop above cannot spin on a pathological
 * window size.
 */
const MAX_SCALE = 8;

/**
 * The smallest grid the scale-bump is allowed to land on.
 *
 * It is the REFERENCE ITSELF, 1280x720. Below that the cure is worse than the
 * letterbox, and worse than that it is incoherent: RENDER_W's contract is that
 * the player never sees less than 1280x720 worth of level, and a bump the
 * ceiling forced was the one path that broke it (2162x1216 landed on 1082x608
 * before 2026-08-29). A window that cannot be covered without going under the
 * reference gets bars instead — which is what the ceiling existed to do before
 * it started producing them in the ordinary case.
 */
const MIN_BUMP_W = RENDER_W;
const MIN_BUMP_H = RENDER_H;

export interface PixelPass {
  target: THREE.WebGLRenderTarget;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  /**
   * The passes the LAST `render()` issued, in submission order.
   *
   * The GPU timestamp pool returns one duration per render context in the order
   * they were allocated, with no names attached. Zipping that against this list
   * is what turns "the frame cost 3.7 ms on the GPU" into "the scene cost 2.1
   * and the composite cost 1.2" — the only form of the number that can point at
   * something to fix. The bloom chain is conditional, so this is the truth
   * about what ran rather than a fixed list.
   */
  passOrder(): readonly string[];
  /**
   * The post chain's own scene, camera, quad and materials — for asking the
   * renderer what WGSL it actually generated from this file's TSL.
   *
   * The quad is not in the game scene (it lives in a private ortho scene, so
   * that nothing in the world can be drawn over it), which means a harness
   * cannot reach it by traversal. `renderer.debug.getShaderAsync` needs the
   * exact scene/camera/object triple the pipeline was compiled for, so all
   * four come out together or the dump describes a different program.
   */
  debugPost(): {
    scene: THREE.Scene;
    camera: THREE.Camera;
    quad: THREE.Mesh;
    materials: Record<string, THREE.Material>;
  };
  /**
   * Present a frame that is NOTHING BUT THE UI — no scene, no bloom chain.
   *
   * ── WHY THIS EXISTS ──
   * There is exactly one moment in the game when a frame must reach the screen
   * and the scene must NOT be drawn: a descent. `warmFloorPipelines` compiles a
   * floor's shaders deliberately, in batches, behind the descent screen, and
   * rendering the scene during that would trigger the lazy compile storm the
   * warm-up exists to schedule. So the frame loop refuses to render while the
   * hold is up (`isRenderHeld`).
   *
   * That was correct when the descent screen was DOM — the browser composited it
   * independently of anything three did. It became a black screen the moment the
   * screen moved onto the canvas, because the canvas UI is painted by the very
   * loop that is held. The one screen whose entire job is to be visible while
   * the loop is blocked was the one screen the loop refused to draw.
   *
   * This is the way out: composite the UI over a CLEARED target. The only
   * pipeline it can touch is the final composite's own — one shader, which has
   * to compile before any frame reaches the screen anyway, so paying for it here
   * (behind the loading screen) is strictly better than paying for it after.
   *
   * Both sources the composite samples are cleared, not left stale: the UI layer
   * covers the grid only to `floor(grid / zoom) * zoom`, so a screen at a zoom
   * that does not divide the grid leaves a one-or-two pixel margin. Uncleared,
   * that margin shows a strip of the floor that was just torn down.
   */
  presentUi(): void;
  /**
   * Run `fn` with the renderer in exactly the state `render()` draws the scene
   * in — the scene target bound and the MRT declared.
   *
   * ── WHY A PRECOMPILE HAS TO BORROW THE RENDER STATE ──
   *
   * three bakes the MRT into the node material's build (`NodeMaterial.setup`
   * swaps the result node for the MRT node when `renderer.getMRT()` is set), so
   * a material compiled with no MRT declared produces a DIFFERENT program from
   * the one the frame will ask for. `compileAsync` called outside this wrapper
   * therefore warms pipelines nothing will ever look up, and every material
   * compiles again — lazily, mid-play — on the first real frame.
   *
   * That is not a hypothetical: it is precisely the stall `boot/warmup.ts`
   * exists to prevent, and it would have come back silently, as a performance
   * regression with no error and nothing in the suite able to see it.
   */
  withSceneContext<T>(fn: () => T): T;
  /**
   * Re-derive the render size for a new window size. Unlike the old fixed-RT
   * version this CAN reallocate the render targets, so it guards on the
   * computed size and does nothing expensive when that is unchanged.
   */
  resize(): void;
  /**
   * The CURRENT grid. The UI layer sizes its canvas from this and the pointer
   * mapping converts through it, so both must read the pass's own value rather
   * than recompute `computeRenderSizing(window…)` — a second copy of that call
   * is a second source of truth that drifts for one frame after every resize,
   * which is exactly long enough for a click to land in the wrong place.
   */
  sizing(): Readonly<RenderSizing>;
  /** Composite the UI layer at all. Off costs nothing; see `finalNode`. */
  setUiEnabled(on: boolean): void;
  setQuantize(on: boolean): void;
  setDither(on: boolean): void;
  setScanline(on: boolean): void;
  setOutline(on: boolean): void;
  setBloom(on: boolean): void;
  setAo(on: boolean): void;
  /** The cel grade on/off — see CEL_DEFAULT in constants/render.ts. */
  setCel(on: boolean): void;
  /**
   * Retune the grade live: luma rungs, saturation multiplier, rung spacing.
   *
   * All three are uniforms rather than folded constants specifically so the look
   * can be A/B'd on a real adapter without a rebuild — which is how the shipped
   * numbers were chosen. Reachable from the console as `__dungeonCel`.
   *
   * `curve` omitted keeps the current value, so an existing two-argument call
   * retunes the rungs without silently resetting the spacing. Pass 1 for the
   * evenly-spaced rungs that shipped before 2026-08-03.
   */
  setCelGrade(steps: number, saturation: number, curve?: number): void;
  /**
   * Frenzy FX (combo Part 2): drive the vignette pull + chromatic aberration
   * from a [0,1] intensity. 0 restores the baseline vignette and zero split.
   */
  setFrenzyFx(intensity: number): void;
  /** Full-screen white flash [0,1] — the katana-finisher beat. 0 = off. */
  setFlash(intensity: number): void;
  /**
   * Turn the heat shimmer on or off.
   *
   * HONEST NOTE: this is a LOOK toggle, not a performance one. The shimmer's ALU
   * is compiled into `finalMat` unconditionally, so gating it at runtime saves
   * nothing — a `heat` of 0 still evaluates two noise octaves and eight distance
   * tests per pixel. If that ever needs to actually go away it has to become a
   * build-time flag in `opts` (like `bloom`) and rebuild the material, and this
   * comment is here so nobody assumes it already is one.
   *
   * ── AND THE COST OF CARRYING IT IS NOW MEASURED (2026-07-30) ──
   * `finalMat` is the one shader that must be ready before any frame reaches the
   * screen, so anything it grows lands on every player's boot. That was left
   * unquantified when the shimmer shipped. Measured since, on nvidia/ampere
   * through host Chrome (WebGPU), by compiling a fresh copy of this exact graph
   * with `compileAsync` on a quiet main thread — five rounds, arms interleaved
   * and the order alternated each round, a unique trailing multiply per call so
   * no arm could hit the pipeline cache the shipped material had already filled:
   *
   *     with the warp    46 ms median   [70, 58, 46, 45, 43]
   *     without it       45 ms median   [45, 54, 39, 59, 42]
   *     POSITIVE CONTROL — the warp applied EIGHT times:
   *                      61 ms median   [63, 58, 62, 58, 61]
   *
   * So the instrument does see ALU (~2 ms per extra warp, +16 ms at ×8), and the
   * one warp we actually ship costs ~1-2 ms of a ~45 ms compile: real, and far
   * below the run-to-run spread. The control is the point — without it "+1 ms"
   * is indistinguishable from a bench that cannot see shader size at all.
   *
   * That is why this is still a runtime uniform. Making it build-time would buy
   * ~1 ms of boot and cost the LIVE settings toggle (the material would have to
   * be rebuilt on every change), which is a bad trade at this price.
   */
  setHeatEnabled(on: boolean): void;
  /**
   * Screen-space heat sources for the shimmer.
   *
   * PLAIN NUMBERS ONLY, and that is a boundary, not a style: `engine/` imports
   * zero game content (`engine/purity.test.ts`), so a `setHeat(fx: FloorFx[])`
   * signature would make the engine learn what a fire puddle is and fail that
   * test. The game projects and ranks; the engine just warps.
   *
   * `xs`/`ys` are RT UV (0..1, v already matched to `rtUv()` — see `fx/heat.ts`
   * for the flip that is easy to omit and impossible to see), `rs` a UV radius.
   * `n` slots are used; the rest are zeroed. `t` is the shimmer clock in seconds.
   */
  setHeat(xs: Float32Array, ys: Float32Array, rs: Float32Array, n: number, t: number): void;
  dispose(): void;
}

export function createPixelPass(
  renderer: WebGPURenderer,
  opts: {
    quantize: boolean;
    dither: boolean;
    scanline: boolean;
    outline: boolean;
    bloom: boolean;
    ao: boolean;
    /**
     * The cel grade — luma posterize + saturation, the art direction that
     * replaced the retired palette snap. See CEL_DEFAULT in constants/render.ts
     * for what it is for and what was measured against it.
     */
    cel: boolean;
    /**
     * The in-game UI layer, composited late in `finalNode`.
     *
     * INJECTED, not imported: `engine/purity.test.ts` forbids the engine from
     * reaching into game content, and the UI's canvas, screens and input all
     * live in the game. The engine only ever knows "there is a texture the size
     * of my grid, blend it in near the end".
     *
     * Must be a stable object for the lifetime of the pass — the node graph
     * binds it at build time. `gui/layer.ts` guarantees that and reallocates
     * behind it on resize.
     */
    uiTexture: THREE.Texture;
  },
): PixelPass {
  // We want fat honest pixels, so devicePixelRatio is deliberately ignored.
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.NoToneMapping;
  // The final composite does its own linear→sRGB BEFORE the palette snap (the
  // palette is sRGB, and dither/quantize must run in that space). The legacy
  // WebGLRenderer skipped its output encode for any ShaderMaterial that didn't
  // `#include <colorspace_fragment>`; WebGPURenderer's node pipeline applies
  // the canvas encode to EVERY material, which double-encoded the whole game
  // (measured: the same shader read (26,40,27) on an offscreen target and
  // (54,59,70) on the canvas — everything washed out). Declaring the output as
  // linear-sRGB turns that second encode into a no-op. Only the final quad ever
  // draws to the canvas, so nothing else is affected.
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  // Everything below is sized from THIS, and re-sized from it on every resize.
  let sizing = computeRenderSizing(window.innerWidth, window.innerHeight, cancelBrowserZoom());

  // The depth texture feeds the outline and AO passes. We never call setSize on
  // it directly: three re-syncs `depthTexture.image` to the render target's
  // dimensions (and flags needsUpdate) inside setupDepthTexture, and doing it
  // by hand would defeat that dirty check.
  const depthTexture = new THREE.DepthTexture(sizing.renderW, sizing.renderH);
  depthTexture.type = THREE.UnsignedIntType;

  /**
   * TWO colour attachments: the lit frame, and the ALBEDO the materials were
   * before any light touched them.
   *
   * The names are not decoration — three resolves an MRT output to a slot by
   * matching the key in `mrt({...})` against `textures[i].name`, so a typo here
   * does not error, it silently writes nothing to the albedo and the whole
   * screen snaps to void.
   */
  const sceneTarget = new THREE.WebGLRenderTarget(sizing.renderW, sizing.renderH, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
    depthBuffer: true,
    stencilBuffer: false,
    depthTexture,
    count: 2,
  });
  sceneTarget.textures[0].name = "output";
  sceneTarget.textures[1].name = "albedo";

  /**
   * ── THE MRT DECLARATION ────────────────────────────────────────────────────
   *
   * `diffuseColor` is the node every three material assigns in `setupDiffuseColor`:
   * `color * map * vertexColor`, in the linear working space, before any light,
   * shadow, AO or fog. For a `MeshStandardMaterial` that is the masonry's own
   * tone; for the unlit `MeshBasicMaterial` the sprites use it is the atlas texel,
   * which is already a palette entry; for the seven `colorNode` effect materials
   * in `fx/` it is the colour they compute, which is the right albedo for a flame.
   *
   * ⚠️ THE ONE MATERIAL SHAPE THIS DOES NOT COVER is a raw `NodeMaterial` with a
   * `fragmentNode`, which takes three's fragment-output shortcut and never runs
   * `setupDiffuseColor` at all. Such a material would write an unassigned albedo
   * and render as void. There are none in the scene today — the only
   * `fragmentNode`s in this repo are the post quads in this file, which do not
   * draw into `sceneTarget` — and `mrt-coverage.test.ts` fails if one appears.
   * If you need one, give it a `colorNode` instead, or set its own
   * `material.mrtNode = mrt({ output, albedo: <its colour> })`.
   *
   * ── BLENDING: THE ALBEDO SLOT FOLLOWS THE MATERIAL (fixed 2026-07-31) ──────
   *
   * `MRTNode` defaults every output other than `output` to NO BLENDING, and
   * this file used to keep that default with the argument that "a 30%-alpha
   * decal or an additive spark should write its albedo opaquely rather than
   * smearing it into the surface underneath". That argument is wrong, and it
   * shipped a bug you can see from across the room: **every soft-alpha effect
   * drew a BLACK BOX.**
   *
   * The mechanism, in one line: an unblended write stamps the ENTIRE QUAD,
   * including every fragment the player cannot see. A contact shadow's texture
   * is a radial gradient whose RGB is black EVERYWHERE and whose alpha is the
   * only thing that varies, so the albedo attachment received a full black
   * square, the snap chose void for all of it, and the actor stood on a black
   * tile. Additive sparks are the same story told in reverse: "invisible" for
   * an additive pixel means BLACK (adding nothing), so their transparent
   * surround stamped void too — the discs around the fire trail and the ring
   * under the E-skill sigil.
   *
   * It was invisible until `eb4a9c6`/`d0bbb5b` moved the snap onto the albedo.
   * Before that the snap read the lit frame, where the blend had already
   * happened and the surround had already vanished.
   *
   * So the slot now uses each material's OWN blending, which makes the
   * arithmetic come out right for both shapes without a per-material opt-in:
   *
   *   opaque geometry   alpha 1, NormalBlending  → src·1 + dst·0 = src, as before
   *   additive spark    alpha ~0 in the surround → src·0 + dst·1 = dst, PRESERVED
   *   soft decal/shadow alpha a                  → the albedo darkens by `a`,
   *                                                which is what a shadow IS
   *
   * The old reasoning's fear — "a weighted average of two materials landing in
   * a third" — is real but bounded: it can only happen where a translucent
   * effect genuinely covers a surface, and a wrong family under a 40% decal is
   * a far smaller defect than a void rectangle under every actor in the game.
   *
   * ⚠️ Needs `OES_draw_buffers_indexed` on the WebGL2 path (per-attachment
   * blend funcs). Verified present on the shipped production adapter; without
   * it three warns once and falls back to the material's blending for ALL
   * attachments, which is the same behaviour this line asks for anyway.
   */
  const sceneMrt = mrt({ output: output, albedo: diffuseColor }).setBlendMode(
    "albedo",
    new BlendMode(THREE.MaterialBlending),
  );

  // Bloom works at half resolution — cheaper, and a wider blur for free. These
  // track the render size (exactly half, since renderW/H are guaranteed even)
  // and are read live in render(), because the blur step is 1/BW texels.
  let BW = sizing.renderW / 2;
  let BH = sizing.renderH / 2;
  const bloomTargetOpts = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
    depthBuffer: false,
    stencilBuffer: false,
  };
  const bloomA = new THREE.WebGLRenderTarget(BW, BH, bloomTargetOpts);
  const bloomB = new THREE.WebGLRenderTarget(BW, BH, bloomTargetOpts);

  // ── Materials ──
  // NodeMaterial + fragmentNode is the TSL equivalent of a fullscreen-quad
  // ShaderMaterial. Depth test/write stay off exactly as before.
  const blurDir = uniform(new THREE.Vector2());

  const brightMat = new NodeMaterial();
  brightMat.depthTest = false;
  brightMat.depthWrite = false;
  // The LIT frame, explicitly — `.texture` is an alias for `.textures[0]` and
  // would keep working, but the bright-pass reading slot 0 rather than the
  // albedo is a decision (torches bloom because they are BRIGHT, not because of
  // what they are made of), and it should not rest on which slot came first.
  brightMat.fragmentNode = brightNode(sceneTarget.textures[0], uniform(BLOOM_THRESHOLD));

  // The blur runs TWICE per frame over DIFFERENT sources (bloomA then bloomB),
  // and a node graph binds its texture at build time — so this needs one
  // material per direction rather than one mutated `tSrc` uniform.
  const blurMatH = new NodeMaterial();
  blurMatH.depthTest = false;
  blurMatH.depthWrite = false;
  blurMatH.fragmentNode = blurNode(bloomA.texture, blurDir);

  const blurMatV = new NodeMaterial();
  blurMatV.depthTest = false;
  blurMatV.depthWrite = false;
  blurMatV.fragmentNode = blurNode(bloomB.texture, blurDir);

  // Uniform HANDLES, not a plain object: TSL uniforms are nodes whose `.value`
  // is live, which is what lets setFrenzyFx/setFlash/resize poke them.
  const finalUniforms: FinalUniforms = {
    quantize: uniform(opts.quantize ? 1 : 0),
    dither: uniform(opts.dither ? 1 : 0),
    scanline: uniform(opts.scanline ? 1 : 0),
    outline: uniform(opts.outline ? 1 : 0),
    colourOutline: uniform(opts.outline ? 1 : 0),
    edgeThreshold: uniform(OUTLINE_EDGE_THRESHOLD),
    cel: uniform(opts.cel ? 1 : 0),
    celSteps: uniform(CEL_STEPS),
    celCurve: uniform(CEL_CURVE),
    celSaturation: uniform(CEL_SATURATION),
    // Shimmer defaults OFF. The ALU cost is paid regardless (a runtime gate does
    // not remove instructions), so this is a look toggle, not a perf one — see
    // `setHeatEnabled` for the honest note about that.
    heat: uniform(0),
    heatPixels: uniform(HEAT_PIXELS),
    heatTime: uniform(0),
    heatSpots: Array.from({ length: HEAT_SPOTS }, () => uniform(new THREE.Vector3())),
    bloom: uniform(opts.bloom ? BLOOM_STRENGTH : 0),
    ao: uniform(opts.ao ? AO_STRENGTH : 0),
    aoRadius: uniform(AO_RADIUS),
    vignette: uniform(VIGNETTE),
    // Off until a screen opens. The composite is a texture fetch per pixel over
    // the whole grid; there is no reason to pay it while the player is playing.
    ui: uniform(0),
    aberration: uniform(0),
    flash: uniform(0),
    // MUST track the render target. A stale resolution silently misaligns the
    // AO ring, the outline's neighbour taps and the scanline rows — it looks
    // like a completely different bug, so it is updated in resize() below.
    resolution: uniform(new THREE.Vector2(sizing.renderW, sizing.renderH)),
  };
  const finalMat = new NodeMaterial();
  finalMat.depthTest = false;
  finalMat.depthWrite = false;
  finalMat.fragmentNode = finalNode(
    sceneTarget.textures[0],
    sceneTarget.textures[1],
    bloomA.texture,
    depthTexture,
    opts.uiTexture,
    enginePalette.toFloatArray(),
    buildShadedPalette(enginePalette.toFloatArray()),
    finalUniforms,
  );

  // One reusable fullscreen quad; passes swap its material.
  //
  // THE CAMERA NOW HAS TO BE REAL. The old GLSL vertex shader ignored it
  // outright — `gl_Position = vec4(position.xy, 0.0, 1.0)` writes clip space
  // directly, so the quad landed on screen no matter what the camera said, and
  // this camera's near=0 / quad-at-z=0 collision never mattered. NodeMaterial
  // uses the STANDARD vertex path (model-view-projection), so a quad sitting
  // exactly on the near plane is clipped and the screen goes black — with no
  // error, because nothing is wrong except the geometry being invisible.
  //
  // Pulling the camera back and giving it real near/far puts the quad safely
  // inside the frustum. The projection is still a plain 2x2 ortho box, so the
  // quad still maps 1:1 to the viewport.
  const quadScene = new THREE.Scene();
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  quadCam.position.z = 1;
  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const quad: THREE.Mesh = new THREE.Mesh(quadGeo, finalMat);
  quadScene.add(quad);

  /**
   * The passes this frame issued, in submission order.
   *
   * The GPU timestamp pool records one duration per render context and hands
   * them back in the order they were allocated — which is submission order —
   * but with no names on them. This is the other half: the names, in the same
   * order, so `sim/loop.ts` can zip the two and say WHICH pass cost what
   * instead of reporting one total for the whole frame.
   *
   * Reused, never reallocated, and the bloom chain is conditional — so the
   * length is the truth about what ran this frame, not a fixed list.
   */
  const passOrder: string[] = [];

  function blit(material: THREE.Material, dest: THREE.WebGLRenderTarget | null, label = "blit"): void {
    quad.material = material;
    renderer.setRenderTarget(dest);
    passOrder.push(label);
    renderer.render(quadScene, quadCam);
  }

  function resize(): void {
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    // Recomputed per resize, not captured once: a ctrl +/- fires `resize`, and
    // the whole point is that this call absorbs it.
    const next = computeRenderSizing(winW, winH, cancelBrowserZoom());

    // GUARD: resize() now reallocates GPU memory, and browsers fire resize
    // events in bursts while a window is dragged. Only pay for it when the
    // derived target size actually moved — the canvas CSS below is cheap and
    // can be redone unconditionally.
    if (next.renderW !== sizing.renderW || next.renderH !== sizing.renderH) {
      // setSize() disposes the RT's GL resources but keeps the SAME texture
      // objects, so every uniform pointing at sceneTarget.texture / depthTexture
      // / bloomA.texture stays valid without re-pointing.
      sceneTarget.setSize(next.renderW, next.renderH);
      BW = next.renderW / 2;
      BH = next.renderH / 2;
      bloomA.setSize(BW, BH);
      bloomB.setSize(BW, BH);
      finalUniforms.resolution.value.set(next.renderW, next.renderH);
    }
    sizing = next;

    // The DRAWING BUFFER is device pixels; `updateStyle=false` because the CSS
    // box below is a different unit and three must not overwrite it.
    renderer.setSize(sizing.outW, sizing.outH, false);

    // Centre the canvas, in CSS PIXELS. `cssScale` rather than `scale`: under
    // browser zoom one render pixel is `scale` device pixels but only
    // `scale / browserZoom` CSS pixels, and the element is laid out in CSS. Use
    // `scale` here and at 125% zoom the canvas is styled 25% too large, spills
    // its container and gets clipped — the "UI cut off" report, in one line.
    const cssW = Math.round(sizing.renderW * sizing.cssScale);
    const cssH = Math.round(sizing.renderH * sizing.cssScale);
    const el = renderer.domElement;
    el.style.width = `${cssW}px`;
    el.style.height = `${cssH}px`;
    el.style.position = "absolute";
    el.style.left = `${Math.floor((winW - cssW) / 2)}px`;
    el.style.top = `${Math.floor((winH - cssH) / 2)}px`;
    el.style.imageRendering = "pixelated";
  }

  /**
   * Keep the scene camera's frustum matched to the CURRENT render size.
   *
   * This is the half of the change that is easy to miss and fatal to skip. The
   * ortho frustum is derived from the render resolution (constants.ts:
   * VIEW_W = RENDER_W / PPU) but is baked in once by createDungeonCamera().
   * With a fixed 1280x720 target that was fine. Now the target grows with the
   * window, so a frustum left at 20x11.25 tiles would be stretched across a
   * 1920-wide target — 96 px per world unit instead of 64. PPU would silently
   * stop being 64, and the sprite identity SPRITE_UNITS * PPU ===
   * SPRITE_PIXEL_GRID (72 texels → 72 render pixels) would break, reintroducing
   * exactly the uneven sprite-pixel sizes this whole change exists to kill.
   *
   * So: PPU stays pinned at 64 and the FRUSTUM flexes. Because renderW/renderH
   * are even, the half-extents land on whole texels and the frustum centre
   * stays on the pixel grid.
   *
   * Done here rather than in resize() because this is where we are handed the
   * camera; it is a cheap identity check on every frame and a real update only
   * when something moved. `zoom` is untouched (the tavern rides on it) — three
   * applies it on top of left/right/top/bottom.
   */
  function syncCameraFrustum(camera: THREE.Camera): void {
    const ortho = camera as THREE.OrthographicCamera;
    if (ortho.isOrthographicCamera) {
      const halfW = sizing.renderW / (2 * PPU);
      const halfH = sizing.renderH / (2 * PPU);
      if (ortho.right !== halfW || ortho.top !== halfH) {
        ortho.left = -halfW;
        ortho.right = halfW;
        ortho.top = halfH;
        ortho.bottom = -halfH;
        ortho.updateProjectionMatrix();
      }
      return;
    }
    // The rampage FPS camera is perspective (fps.ts) — it has no PPU contract,
    // it just must not be stretched by a non-16:9 target.
    const persp = camera as THREE.PerspectiveCamera;
    if (persp.isPerspectiveCamera) {
      const aspect = sizing.renderW / sizing.renderH;
      if (persp.aspect !== aspect) {
        persp.aspect = aspect;
        persp.updateProjectionMatrix();
      }
    }
  }

  function render(scene: THREE.Scene, camera: THREE.Camera): void {
    // Same reason as `presentUi` below: `warmFirstFrame` calls this while a warm
    // may still be in flight, and the composite blit ends on the canvas. Null
    // during normal play, so this only does anything mid-warm.
    const entry = renderer.getRenderTarget();
    syncCameraFrustum(camera);
    // Cleared at the TOP of the frame, not the bottom: the timestamp resolve is
    // async and reads this a frame or two later, so a list emptied on the way
    // out would always be read empty.
    passOrder.length = 0;

    // 1. Scene → linear target (+ depth), writing lit AND albedo.
    //
    // The MRT is scoped to this one call and cleared straight after, matching
    // what three's own PostProcessing does. It has to be: every other draw in
    // this file is a fullscreen quad into a SINGLE-attachment target, and an MRT
    // declaration left standing would have those quads describing two outputs
    // for one attachment.
    renderer.setRenderTarget(sceneTarget);
    renderer.setMRT(sceneMrt);
    renderer.clear();
    passOrder.push("scene");
    renderer.render(scene, camera);
    renderer.setMRT(null);

    // 2. Bloom chain (skipped when strength is 0).
    if (finalUniforms.bloom.value > 0.001) {
      blit(brightMat, bloomA, "bloom.bright");

      // H then V. Each direction has its own material because a node graph
      // binds its source texture at build time (see the note above).
      blurDir.value.set(BLOOM_RADIUS / BW, 0);
      blit(blurMatH, bloomB, "bloom.blurH"); // reads bloomA

      blurDir.value.set(0, BLOOM_RADIUS / BH);
      blit(blurMatV, bloomA, "bloom.blurV"); // reads bloomB; blurred bloom lands back in bloomA
    }

    // 3. Composite + cel quantize → screen.
    blit(finalMat, null, "composite");
    if (entry !== null) renderer.setRenderTarget(entry);
  }

  /** See `PixelPass.presentUi`. Deliberately step 3 alone, over a clean slate. */
  function presentUi(): void {
    // ── WHY THE ENTRY TARGET IS SAVED AND PUT BACK ─────────────────────────
    //
    // This runs EVERY FRAME of the descent — and the descent is exactly when
    // `warmFloorPipelines` is sitting inside `withSceneContext`, awaiting
    // `compileAsync`. That await yields to the main thread, so these UI frames
    // are interleaved with three's shader builds.
    //
    // `blit(finalMat, null)` leaves the render target on the CANVAS. A build
    // landing in that window reads `renderer.getRenderTarget() === null` in
    // `NodeMaterial.setup`, which gates the entire MRT block, and emits a
    // 1-output shader — cached, and later rejected against the 2-attachment
    // scene target. The MRT itself is still correctly held by
    // `withSceneContext`; it is only the TARGET that this function stole.
    //
    // Measured: the surviving failures all showed `mrt=true, rt=null`, which is
    // the fingerprint of precisely this interleaving and of nothing else.
    const entry = renderer.getRenderTarget();
    renderer.setRenderTarget(sceneTarget);
    renderer.clear();
    // The composite samples the bloom target unconditionally. Skipping the
    // bloom chain without clearing it would smear the last frame of the floor
    // being torn down across the descent screen's margins.
    renderer.setRenderTarget(bloomA);
    renderer.clear();
    blit(finalMat, null);
    // Null during normal play (nothing to restore), sceneTarget while a warm is
    // in flight — so this is a no-op except in the one case that matters.
    if (entry !== null) renderer.setRenderTarget(entry);
  }

  resize();

  function withSceneContext<T>(fn: () => T): T {
    renderer.setRenderTarget(sceneTarget);
    renderer.setMRT(sceneMrt);
    // Restored even if the compile throws — `warmFloorPipelines` deliberately
    // swallows compile failures and plays on, and a leaked MRT would then have
    // every fullscreen quad in this file describing two outputs for one
    // attachment.
    let restored = false;
    const restore = (): void => {
      if (restored) return;
      restored = true;
      renderer.setMRT(null);
      renderer.setRenderTarget(null);
    };
    try {
      const out = fn();
      // ── WHY THIS CANNOT BE A PLAIN `finally` ───────────────────────────────
      //
      // Every caller passes an ASYNC fn: `withSceneContext(() => compileAsync(…))`.
      // A `finally` restores the moment `fn()` hands back its *promise* — which
      // is before three has built a single shader. `compileAsync` awaits per
      // object (`getForRenderAsync`, three r185) specifically to yield to the
      // main thread, so every build it performs ran with the target already
      // unbound.
      //
      // That matters because `NodeMaterial.setup` reads
      // `renderer.getRenderTarget()` ONCE and gates the entire MRT block on it
      // being non-null. A build seeing null emits a 1-output shader, and that
      // shader is cached under a key the real frame reuses — so the scene pass
      // binds two attachments against a fragment stage that declares one and
      // Dawn rejects the pipeline:
      //   "Color target has no corresponding fragment stage output …
      //    While validating targets[1]"
      // followed by an invalid command buffer reaching Queue.Submit.
      //
      // So the context must outlive the await, not the call. Measured: 7-8
      // validation errors per run before, 0 after.
      if (typeof (out as { then?: unknown } | null)?.then === "function") {
        return (out as unknown as Promise<unknown>).then(
          (v) => {
            restore();
            return v;
          },
          (e) => {
            restore();
            throw e;
          },
        ) as unknown as T;
      }
      restore();
      return out;
    } catch (e) {
      restore();
      throw e;
    }
  }

  return {
    target: sceneTarget,
    render,
    passOrder: () => passOrder,
    debugPost: () => ({
      scene: quadScene,
      camera: quadCam,
      quad,
      materials: { final: finalMat, bright: brightMat, blurH: blurMatH, blurV: blurMatV },
    }),
    presentUi,
    withSceneContext,
    resize,
    sizing: () => sizing,
    setUiEnabled: (on) => {
      finalUniforms.ui.value = on ? 1 : 0;
    },
    setQuantize: (on) => {
      finalUniforms.quantize.value = on ? 1 : 0;
    },
    setDither: (on) => {
      finalUniforms.dither.value = on ? 1 : 0;
    },
    setScanline: (on) => {
      finalUniforms.scanline.value = on ? 1 : 0;
    },
    setOutline: (on) => {
      finalUniforms.outline.value = on ? 1 : 0;
    },
    setBloom: (on) => {
      finalUniforms.bloom.value = on ? BLOOM_STRENGTH : 0;
    },
    setAo: (on) => {
      finalUniforms.ao.value = on ? AO_STRENGTH : 0;
    },
    setCel: (on) => {
      finalUniforms.cel.value = on ? 1 : 0;
    },
    setCelGrade: (steps, saturation, curve) => {
      // Rungs below 1 would divide the luma by zero-ish and present as a white
      // frame; saturation is left unclamped on purpose so the debug surface can
      // overshoot deliberately while looking for the ceiling.
      finalUniforms.celSteps.value = Math.max(1, steps);
      finalUniforms.celSaturation.value = Math.max(0, saturation);
      // The shader raises the luma to this and then to its reciprocal, so 0 is a
      // divide-by-zero and the floor is not cosmetic. Undefined = leave it alone.
      if (curve !== undefined) finalUniforms.celCurve.value = Math.max(0.05, curve);
    },
    setFrenzyFx: (intensity) => {
      const t = Math.max(0, Math.min(1, intensity));
      finalUniforms.vignette.value = VIGNETTE + (FRENZY_VIGNETTE - VIGNETTE) * t;
      finalUniforms.aberration.value = FRENZY_ABERRATION * t;
    },
    setFlash: (intensity) => {
      finalUniforms.flash.value = Math.max(0, Math.min(1, intensity));
    },
    setHeatEnabled: (on) => {
      finalUniforms.heat.value = on ? 1 : 0;
    },
    setHeat: (xs, ys, rs, n, t) => {
      finalUniforms.heatTime.value = t;
      const used = Math.min(n, HEAT_SPOTS);
      for (let i = 0; i < HEAT_SPOTS; i++) {
        const v = finalUniforms.heatSpots[i]!.value;
        if (i < used) {
          v.set(xs[i]!, ys[i]!, rs[i]!);
        } else {
          // Radius 0 is what the shader's `step` guard reads as "unused". Leaving
          // a stale radius here would keep a dead fire shimmering.
          v.set(0, 0, 0);
        }
      }
    },
    dispose: () => {
      depthTexture.dispose();
      sceneTarget.dispose();
      bloomA.dispose();
      bloomB.dispose();
      quadGeo.dispose();
      brightMat.dispose();
      blurMatH.dispose();
      blurMatV.dispose();
      finalMat.dispose();
    },
  };
}
