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
import { NodeMaterial } from "three/webgpu";
import {
  dot,
  float,
  floor,
  fract,
  max,
  mix,
  mod,
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
  resolution: TSLUniform<THREE.Vector2>;
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
 * The pre-baked shaded palette: PALETTE_SIZE wide, SHADE_ROWS+1 tall, texel
 * (i, s) = palette entry i walked s rows down its own ramp.
 *
 * NearestFilter and NO colour-space decode: it holds the same sRGB bytes the
 * shader's min-reduction compares against, and letting three "helpfully" decode
 * it would put the lookup in a different space from the snap that chose it.
 */
function buildShadedPalette(palette: Float32Array): THREE.DataTexture {
  const n = Math.floor(palette.length / 3);
  // Built from the INJECTED one-step table rather than imported from the game:
  // `engine/` may not depend on game content (engine-boundary.test.ts), and a
  // colour ramp is art direction. The walk is defined in render/palette-shading.
  const down = enginePalette.shadeDown?.() ?? new Uint8Array(n);
  const rows = new Uint8Array((SHADE_ROWS + 1) * n);
  for (let i = 0; i < n; i++) rows[i] = i;
  for (let s = 1; s <= SHADE_ROWS; s++) {
    for (let i = 0; i < n; i++) rows[s * n + i] = down[rows[(s - 1) * n + i]] ?? 0;
  }
  const data = new Uint8Array(n * (SHADE_ROWS + 1) * 4);
  for (let s = 0; s <= SHADE_ROWS; s++) {
    for (let i = 0; i < n; i++) {
      const src = rows[s * n + i];
      const o = (s * n + i) * 4;
      data[o] = Math.round(palette[src * 3] * 255);
      data[o + 1] = Math.round(palette[src * 3 + 1] * 255);
      data[o + 2] = Math.round(palette[src * 3 + 2] * 255);
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, n, SHADE_ROWS + 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function finalNode(
  diffuse: THREE.Texture,
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

  // Derived from the array actually handed in, not from a module constant: the
  // palette is injected by the game, so its size is only known here. The
  // unrolled snap below depends on this being the real count — a stale size
  // would either skip colours or read past the end of the array.
  const PALETTE_SIZE = Math.floor(palette.length / 3);

  // Depth sampling helper — matches `depthAt(texelOffset)` in the GLSL.
  const depthAt = (ox: number, oy: number): TSLNode =>
    texture(depth, vUv.add(vec2(ox, oy).div(res))).x;

  // ── Chromatic aberration: split R/B outward from centre. `uAberration = 0`
  // must reduce to EXACTLY the single-tap fetch, so it is a mix, not a scale.
  const off = vUv.sub(0.5).mul(u.aberration);
  const plain = texture(diffuse, vUv).rgb;
  const split = vec3(texture(diffuse, vUv.add(off)).r, plain.g, texture(diffuse, vUv.sub(off)).b);
  let col: TSLNode = mix(plain, split, u.aberration.greaterThan(0.0001).select(float(1), float(0)));

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
      const diff = c0.sub(texture(depth, vUv.add(d.div(res))).x);
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
  col = col.add(texture(bloomTex, vUv).rgb.mul(u.bloom));

  // ── Accurate linear → sRGB transfer (done by hand; see the file header).
  const lo: TSLNode = col.mul(12.92);
  const hi: TSLNode = pow(max(col, vec3(0, 0, 0)), vec3(1 / 2.4, 1 / 2.4, 1 / 2.4)).mul(1.055).sub(0.055);
  // step() is typed float-only, but GLSL step() is COMPONENTWISE on vec3 and
  // that is exactly what the original shader relied on for the per-channel
  // sRGB knee. The graph handles vec3 fine; only the .d.ts is narrow.
  const knee: TSLNode = (step as TSLNode)(vec3(0.0031308, 0.0031308, 0.0031308), col);
  col = mix(lo, hi, knee);

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
  // The four neighbour taps are shared between the luma edge and the warmth
  // gate below, so they are fetched once here rather than inside each helper.
  const nbTap = (ox: number, oy: number): TSLNode =>
    texture(diffuse, vUv.add(vec2(ox, oy).div(res))).rgb;
  const nbs: TSLNode[] = [nbTap(1, 0), nbTap(-1, 0), nbTap(0, 1), nbTap(0, -1)];
  const lumaOf = (c: TSLNode): TSLNode => dot(sqrt(max(c, vec3(0, 0, 0))), LUMA);
  // lumaOf on a re-fetch of (0,0) would duplicate `plain` — same texel, same
  // filter, same result; one fetch fewer.
  const lc = lumaOf(plain);
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
  const warmOf = (c: TSLNode): TSLNode => (step as TSLNode)(c.g, c.r);
  const allWarm: TSLNode = warmOf(plain)
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
  // The UI is not IN the world, so it must not be lit by it. An opaque menu
  // pixel is forced back to full light, or the corners of a paused inventory
  // would dim under the vignette that happens to be behind them.
  light = mix(light, float(1), uiTexel.a.mul(u.ui));

  // ── Full-screen flash BEFORE dither/quantize, so the wash snaps to the
  // palette's bright ramp like everything else.
  col = mix(col, vec3(1, 1, 1), u.flash);

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
  let best: TSLNode = vec3(palette[0], palette[1], palette[2]);
  const d0 = col.sub(best).mul(vec3(0.3, 0.59, 0.11));
  let bestDist: TSLNode = dot(d0, d0);
  let bestIdx: TSLNode = float(0);
  for (let i = 1; i < PALETTE_SIZE; i++) {
    const pc = vec3(palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2]);
    const d = col.sub(pc).mul(vec3(0.3, 0.59, 0.11));
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
  // ⚠️ "AS LIT" IS NOT "UNLIT", AND THE DIFFERENCE IS STILL A REAL BUG. `col`
  // here is the diffuse render target: the scene's own three.js lighting —
  // coloured ambient at 3.5, hemi, the cold key light, and six flame-orange
  // torch PointLights at intensity 6 — is already multiplied into it. That is
  // the SAME cross-family multiply this machinery exists to prevent, arriving
  // from the dominant light source instead of from AO, so torch-lit stone can
  // still snap into leather/ember. BLUEPRINT.md records the extreme version of
  // it (torches at intensity 18 turned the cold crypt into a cosy burrow).
  // Fixing it properly needs an albedo/material target so the snap sees unlit
  // colour and the whole lighting chain collapses into `light`. Not done here;
  // do not read this block as though it were.
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
  // Dither the TARGET, where a nudge can only move a pixel between two rungs of
  // its own ramp. 0.03 is roughly half a typical ramp step in luma.
  const target = dot(best, LUMA_W).mul(light).add(b.mul(0.03).mul(u.dither));
  let shaded: TSLNode = texture(shadedPal, vec2(bestIdx.add(0.5).div(PALETTE_SIZE), float(0.5).div(SHADE_ROWS + 1))).rgb;
  let bestGap: TSLNode = dot(shaded, LUMA_W).sub(target).abs();
  for (let s = 1; s <= SHADE_ROWS; s++) {
    const rowRgb = texture(shadedPal, vec2(bestIdx.add(0.5).div(PALETTE_SIZE), float(s + 0.5).div(SHADE_ROWS + 1))).rgb;
    const gap = dot(rowRgb, LUMA_W).sub(target).abs();
    const nearer = gap.lessThan(bestGap);
    shaded = nearer.select(rowRgb, shaded);
    bestGap = nearer.select(gap, bestGap);
  }
  col = mix(col.mul(light), shaded, u.quantize);

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
 *   scale   = max(1, floor(min(winW / RENDER_W, winH / RENDER_H)))
 *   renderW = evenCeil(winW / scale)   ⇒  renderW * scale >= winW
 * RENDER_W/RENDER_H are the reference FLOOR: the zoom is chosen against them,
 * so the player never sees less of the level than 1280x720 was showing. They
 * may see somewhat more (see the constants.ts note) — that is the unavoidable
 * cost of integer scale + no letterbox + fixed PPU.
 *
 * WHY EVEN. An ODD render width puts the orthographic frustum's centre on a
 * half-texel: `left = -renderW / (2 * PPU)` is then a half-pixel offset, and
 * EVERY sprite in the scene inherits that half-pixel shift and samples between
 * texels. Rounding up to even costs at most one render pixel and keeps the
 * frustum centre exactly on the grid.
 *
 * WHY A CAP. renderW ≈ winW / floor(winW / 1280) is mostly self-limiting, but
 * a very wide, short window pins scale at 1 while the width runs away
 * (7680x1080 would ask for a 7680-wide target). When MAX_RENDER_* bites we
 * KEEP the integer scale and letterbox instead — crispness is the invariant.
 */
export function computeRenderSizing(winW: number, winH: number, zoom = 1): RenderSizing {
  // The window in ZOOM-CANCELLED pixels — see `cancelBrowserZoom`. `winW * zoom`
  // is the PHYSICAL viewport, in the units it would have at 100% zoom, whatever
  // the zoom is now and whatever it was when the page loaded. So every number
  // derived below is invariant under ctrl +/- AND under a reload while zoomed.
  const w = Math.max(1, Math.floor(winW * zoom));
  const h = Math.max(1, Math.floor(winH * zoom));

  const baseScale = Math.max(1, Math.floor(Math.min(w / RENDER_W, h / RENDER_H)));

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
 * Below this the cure is worse than the letterbox: 4:3 of the reference, i.e.
 * the point where the level stops being readable. A window that cannot be
 * covered without going under it gets bars instead, which is what the ceiling
 * existed to do before it started producing them in the ordinary case.
 */
const MIN_BUMP_W = 1024;
const MIN_BUMP_H = 576;

export interface PixelPass {
  target: THREE.WebGLRenderTarget;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
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
  /**
   * Frenzy FX (combo Part 2): drive the vignette pull + chromatic aberration
   * from a [0,1] intensity. 0 restores the baseline vignette and zero split.
   */
  setFrenzyFx(intensity: number): void;
  /** Full-screen white flash [0,1] — the katana-finisher beat. 0 = off. */
  setFlash(intensity: number): void;
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

  const sceneTarget = new THREE.WebGLRenderTarget(sizing.renderW, sizing.renderH, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
    depthBuffer: true,
    stencilBuffer: false,
    depthTexture,
  });

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
  brightMat.fragmentNode = brightNode(sceneTarget.texture, uniform(BLOOM_THRESHOLD));

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
    sceneTarget.texture,
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

  function blit(material: THREE.Material, dest: THREE.WebGLRenderTarget | null): void {
    quad.material = material;
    renderer.setRenderTarget(dest);
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
    syncCameraFrustum(camera);

    // 1. Scene → linear target (+ depth).
    renderer.setRenderTarget(sceneTarget);
    renderer.clear();
    renderer.render(scene, camera);

    // 2. Bloom chain (skipped when strength is 0).
    if (finalUniforms.bloom.value > 0.001) {
      blit(brightMat, bloomA);

      // H then V. Each direction has its own material because a node graph
      // binds its source texture at build time (see the note above).
      blurDir.value.set(BLOOM_RADIUS / BW, 0);
      blit(blurMatH, bloomB); // reads bloomA

      blurDir.value.set(0, BLOOM_RADIUS / BH);
      blit(blurMatV, bloomA); // reads bloomB; blurred bloom lands back in bloomA
    }

    // 3. Composite + cel quantize → screen.
    blit(finalMat, null);
  }

  /** See `PixelPass.presentUi`. Deliberately step 3 alone, over a clean slate. */
  function presentUi(): void {
    renderer.setRenderTarget(sceneTarget);
    renderer.clear();
    // The composite samples the bloom target unconditionally. Skipping the
    // bloom chain without clearing it would smear the last frame of the floor
    // being torn down across the descent screen's margins.
    renderer.setRenderTarget(bloomA);
    renderer.clear();
    blit(finalMat, null);
  }

  resize();

  return {
    target: sceneTarget,
    render,
    presentUi,
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
    setFrenzyFx: (intensity) => {
      const t = Math.max(0, Math.min(1, intensity));
      finalUniforms.vignette.value = VIGNETTE + (FRENZY_VIGNETTE - VIGNETTE) * t;
      finalUniforms.aberration.value = FRENZY_ABERRATION * t;
    },
    setFlash: (intensity) => {
      finalUniforms.flash.value = Math.max(0, Math.min(1, intensity));
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
