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
function finalNode(
  diffuse: THREE.Texture,
  bloomTex: THREE.Texture,
  depth: THREE.Texture,
  uiTex: THREE.Texture,
  palette: Float32Array,
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
  col = col.mul(float(1).sub(aoTerm.mul(u.ao)));

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
  col = col.mul(mix(float(1), vig, u.vignette));

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
  const dc = depthAt(0, 0);
  const e = max(
    max(depthAt(1, 0).sub(dc).abs(), depthAt(-1, 0).sub(dc).abs()),
    max(depthAt(0, 1).sub(dc).abs(), depthAt(0, -1).sub(dc).abs()),
  );
  // Sampled on the tone-mapped colour (a rough gamma via sqrt), not on linear:
  // linear luma is crushed at the dark end, and this dungeon is nearly all dark
  // end, so a linear threshold would fire on highlights and never on the
  // shadowed silhouettes that need it.
  const LUMA = vec3(0.3, 0.59, 0.11);
  const lumaAt = (ox: number, oy: number): TSLNode =>
    dot(sqrt(max(texture(diffuse, vUv.add(vec2(ox, oy).div(res))).rgb, vec3(0, 0, 0))), LUMA);
  const lc = lumaAt(0, 0);
  const le = max(
    max(lumaAt(1, 0).sub(lc).abs(), lumaAt(-1, 0).sub(lc).abs()),
    max(lumaAt(0, 1).sub(lc).abs(), lumaAt(0, -1).sub(lc).abs()),
  );
  // Void/sky is excluded the same way the AO ring excludes it: the edge where
  // the level meets nothing is already the strongest depth edge on the screen,
  // and inking it twice just thickens it.
  // Comparisons yield bool nodes, which carry no arithmetic — every one is
  // `select`ed to 0/1 before it meets a multiply.
  const notVoid: TSLNode = dc.lessThan(0.999).select(float(1), float(0));
  const colourEdge: TSLNode = le.greaterThan(u.edgeThreshold).select(float(1), float(0)).mul(notVoid).mul(u.colourOutline);
  const depthEdge: TSLNode = e.greaterThan(float(0.35 / 200)).select(float(1), float(0));
  const inked = max(depthEdge, colourEdge).greaterThan(float(0.5)).select(float(0.45), float(1));
  col = col.mul(mix(float(1), inked, u.outline));

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
  // UV: `rtUv()`, the same flipped UV as every other sample in this shader.
  // The UI texture keeps three's default flipY=true, which puts canvas row 0 at
  // v=1; screen-top is uv().y=0; so the flip is what lands row 0 at the top.
  // Judge this with an ASYMMETRIC probe (`__gui.probe()`), never with a centred
  // menu — this repo shipped a v-flip fix twice by eyeballing symmetric content.
  const uiTexel: TSLNode = texture(uiTex, rtUv());
  col = mix(col, uiTexel.rgb, uiTexel.a.mul(u.ui));

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
  col = col.add(b.mul(2 / PALETTE_SIZE).mul(u.dither));

  // ── Snap to the nearest palette entry, luma-weighted. Unrolled over the 32
  // colours: the palette is a compile-time constant here, so this becomes a
  // flat min-reduction with no uniform array indexing.
  let best: TSLNode = vec3(palette[0], palette[1], palette[2]);
  let bestDist: TSLNode = float(1e9);
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const pc = vec3(palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2]);
    const d = col.sub(pc).mul(vec3(0.3, 0.59, 0.11));
    const dist = dot(d, d);
    const closer = dist.lessThan(bestDist);
    best = closer.select(pc, best);
    bestDist = closer.select(dist, bestDist);
  }
  col = mix(col, best, u.quantize);

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
  /** Canvas CSS width  = renderW * scale. */
  outW: number;
  /** Canvas CSS height = renderH * scale. */
  outH: number;
  /** True when MAX_RENDER_* clamped the target, so outW/outH no longer cover the window. */
  capped: boolean;
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
export function computeRenderSizing(winW: number, winH: number): RenderSizing {
  const w = Math.max(1, Math.floor(winW));
  const h = Math.max(1, Math.floor(winH));

  const scale = Math.max(1, Math.floor(Math.min(w / RENDER_W, h / RENDER_H)));

  const wantW = evenCeil(w / scale);
  const wantH = evenCeil(h / scale);

  // FLOOR at the reference. A window smaller than 1280x720 would otherwise
  // shrink the render target and hand the player a cropped view of the level —
  // the minimum logical resolution is a design guarantee, not an optimisation.
  // Below the floor the canvas is LARGER than the window and overflows (the
  // container clips it), which keeps the intended field of view intact.
  // CEILING at MAX_RENDER_*; only that clamp counts as `capped`, because it is
  // the only one that stops us covering the window.
  const renderW = Math.min(Math.max(wantW, RENDER_W), MAX_RENDER_W);
  const renderH = Math.min(Math.max(wantH, RENDER_H), MAX_RENDER_H);

  return {
    scale,
    renderW,
    renderH,
    outW: renderW * scale,
    outH: renderH * scale,
    capped: renderW < wantW || renderH < wantH,
  };
}

export interface PixelPass {
  target: THREE.WebGLRenderTarget;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
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
  let sizing = computeRenderSizing(window.innerWidth, window.innerHeight);

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
    const next = computeRenderSizing(winW, winH);

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

    renderer.setSize(sizing.outW, sizing.outH, false);

    // Centre the canvas. Normally outW/outH cover the window exactly (the whole
    // point of the adaptive size); bars only appear in the capped case.
    const el = renderer.domElement;
    el.style.width = `${sizing.outW}px`;
    el.style.height = `${sizing.outH}px`;
    el.style.position = "absolute";
    el.style.left = `${Math.floor((winW - sizing.outW) / 2)}px`;
    el.style.top = `${Math.floor((winH - sizing.outH) / 2)}px`;
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

  resize();

  return {
    target: sceneTarget,
    render,
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
