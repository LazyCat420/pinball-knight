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
import { PALETTE_SIZE, paletteToFloatArray } from "./palette";
import {
  RENDER_W,
  RENDER_H,
  MAX_RENDER_W,
  MAX_RENDER_H,
  PPU,
  BLOOM_THRESHOLD,
  BLOOM_STRENGTH,
  BLOOM_RADIUS,
  AO_RADIUS,
  AO_STRENGTH,
  VIGNETTE,
  FRENZY_VIGNETTE,
  FRENZY_ABERRATION,
} from "../constants";

const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// ── Bloom: bright-pass ──────────────────────────────────────────
// Keep only what's brighter than the threshold, softly. Runs in linear.
const BRIGHT_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = clamp((l - uThreshold) / max(1.0 - uThreshold, 0.001), 0.0, 1.0);
  gl_FragColor = vec4(c * k, 1.0);
}
`;

// ── Bloom: separable 9-tap gaussian ─────────────────────────────
const BLUR_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uDir; // texel step * radius, along one axis
varying vec2 vUv;
void main() {
  // Normalised gaussian weights (sigma ~2).
  float w0 = 0.227027;
  float w1 = 0.194595;
  float w2 = 0.121622;
  float w3 = 0.054054;
  float w4 = 0.016216;
  vec3 c = texture2D(tSrc, vUv).rgb * w0;
  c += texture2D(tSrc, vUv + uDir * 1.0).rgb * w1;
  c += texture2D(tSrc, vUv - uDir * 1.0).rgb * w1;
  c += texture2D(tSrc, vUv + uDir * 2.0).rgb * w2;
  c += texture2D(tSrc, vUv - uDir * 2.0).rgb * w2;
  c += texture2D(tSrc, vUv + uDir * 3.0).rgb * w3;
  c += texture2D(tSrc, vUv - uDir * 3.0).rgb * w3;
  c += texture2D(tSrc, vUv + uDir * 4.0).rgb * w4;
  c += texture2D(tSrc, vUv - uDir * 4.0).rgb * w4;
  gl_FragColor = vec4(c, 1.0);
}
`;

// ── Final composite + cel quantize ──────────────────────────────
const FINAL_FRAG = /* glsl */ `
precision highp float;

uniform sampler2D tDiffuse;
uniform sampler2D tBloom;
uniform sampler2D tDepth;
uniform vec3  uPalette[${PALETTE_SIZE}];
uniform float uQuantize;
uniform float uDither;
uniform float uScanline;
uniform float uOutline;
uniform float uBloom;      // bloom strength (0 = off)
uniform float uAo;         // AO strength (0 = off)
uniform float uAoRadius;   // AO ring radius in texels
uniform float uVignette;   // corner darkening (0 = off)
uniform float uAberration; // chromatic RGB split toward the corners (0 = off)
uniform float uFlash;      // full-screen white flash (katana finisher), 0 = off
uniform vec2  uResolution;

varying vec2 vUv;

// Accurate linear → sRGB transfer.
vec3 linearToSRGB(vec3 c) {
  c = max(c, vec3(0.0));
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

// Compact Bayer 4x4 — returns [0,1).
float bayer2(vec2 a) {
  a = floor(a);
  return fract(a.x / 2.0 + a.y * a.y * 0.75);
}
float bayer4(vec2 a) {
  return bayer2(0.5 * a) * 0.25 + bayer2(a);
}

float depthAt(vec2 texelOffset) {
  return texture2D(tDepth, vUv + texelOffset / uResolution).x;
}

// Screen-space AO from the (ortho ⇒ linear) depth buffer. A concave corner —
// wall base meeting the floor — has neighbours that sit CLOSER to the camera
// than the centre; we sample a ring at two radii and darken by how many
// neighbours are moderately closer. Tiny diffs (flat ground) and huge diffs
// (a silhouette against the void) are both excluded, so we get corner AO
// without a halo around every sprite.
float aoTerm() {
  float c = depthAt(vec2(0.0));
  if (c >= 0.999) return 0.0; // void / sky — nothing to occlude
  float occ = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.7853981634; // 2π / 8
    vec2 dir = vec2(cos(a), sin(a));
    for (int r = 1; r <= 2; r++) {
      float rad = uAoRadius * (r == 1 ? 0.5 : 1.0);
      float diff = c - depthAt(dir * rad);
      occ += step(0.00015, diff) * (1.0 - smoothstep(0.004, 0.02, diff));
    }
  }
  return occ / 16.0;
}

void main() {
  // Chromatic aberration (frenzy FX): split R/B outward from centre so the
  // scene edges fringe as the combo peaks — the "edge of control" read. Off
  // (uAberration 0) restores the exact single-tap fetch.
  vec3 col;
  if (uAberration > 0.0001) {
    vec2 off = (vUv - 0.5) * uAberration;
    col = vec3(
      texture2D(tDiffuse, vUv + off).r,
      texture2D(tDiffuse, vUv).g,
      texture2D(tDiffuse, vUv - off).b
    );
  } else {
    col = texture2D(tDiffuse, vUv).rgb; // LINEAR scene
  }

  // AO in linear, before the sRGB curve.
  if (uAo > 0.001) col *= 1.0 - aoTerm() * uAo;

  // Add bloom in linear so bright torch cores bleed a warm halo.
  if (uBloom > 0.001) col += texture2D(tBloom, vUv).rgb * uBloom;

  col = linearToSRGB(col);

  // Vignette — darken toward the corners for a framed, modern look. Applied
  // before the quantizer so the falloff snaps to darker palette steps.
  if (uVignette > 0.001) {
    vec2 q = vUv - 0.5;
    float vig = smoothstep(0.85, 0.32, dot(q, q) * 2.0); // 1 centre → 0 corners
    col *= mix(1.0, vig, uVignette);
  }

  // Depth-discontinuity ink outline (the cel-shading move). With an ORTHO
  // camera the depth buffer is linear in eye space, so a fixed threshold works.
  if (uOutline > 0.5) {
    float dc = depthAt(vec2(0.0));
    float e = max(
      max(abs(depthAt(vec2(1.0, 0.0)) - dc), abs(depthAt(vec2(-1.0, 0.0)) - dc)),
      max(abs(depthAt(vec2(0.0, 1.0)) - dc), abs(depthAt(vec2(0.0, -1.0)) - dc))
    );
    if (e > ${(0.35 / 200).toFixed(6)}) col *= 0.45;
  }

  // Full-screen flash BEFORE dither/quantize so the wash snaps to the palette's
  // bright ramp like everything else — a one-beat white-out, not an overlay.
  if (uFlash > 0.001) col = mix(col, vec3(1.0), uFlash);

  // Nudge each pixel up/down the ramp before snapping — buys back apparent
  // colour depth so smooth gradients (AO, bloom, torch falloff) don't snap into
  // hard concentric bands.
  if (uDither > 0.5) {
    float b = bayer4(gl_FragCoord.xy) - 0.5;
    col += b * (2.0 / float(${PALETTE_SIZE}));
  }

  // Snap to the nearest palette entry, luma-weighted.
  if (uQuantize > 0.5) {
    vec3  best = uPalette[0];
    float bestDist = 1e9;
    for (int i = 0; i < ${PALETTE_SIZE}; i++) {
      vec3 d = (col - uPalette[i]) * vec3(0.30, 0.59, 0.11);
      float dist = dot(d, d);
      if (dist < bestDist) {
        bestDist = dist;
        best = uPalette[i];
      }
    }
    col = best;
  }

  if (uScanline > 0.5) {
    float line = mod(floor(vUv.y * uResolution.y), 2.0);
    col *= mix(1.0, 0.86, line);
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

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
  renderer: THREE.WebGLRenderer,
  opts: {
    quantize: boolean;
    dither: boolean;
    scanline: boolean;
    outline: boolean;
    bloom: boolean;
    ao: boolean;
  },
): PixelPass {
  // We want fat honest pixels, so devicePixelRatio is deliberately ignored.
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.NoToneMapping;

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
  const brightMat = new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: BRIGHT_FRAG,
    uniforms: {
      tSrc: { value: sceneTarget.texture },
      uThreshold: { value: BLOOM_THRESHOLD },
    },
    depthTest: false,
    depthWrite: false,
  });

  const blurMat = new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: BLUR_FRAG,
    uniforms: {
      tSrc: { value: null },
      uDir: { value: new THREE.Vector2() },
    },
    depthTest: false,
    depthWrite: false,
  });

  const finalUniforms = {
    tDiffuse: { value: sceneTarget.texture },
    tBloom: { value: bloomA.texture },
    tDepth: { value: depthTexture },
    uPalette: { value: paletteToFloatArray() },
    uQuantize: { value: opts.quantize ? 1 : 0 },
    uDither: { value: opts.dither ? 1 : 0 },
    uScanline: { value: opts.scanline ? 1 : 0 },
    uOutline: { value: opts.outline ? 1 : 0 },
    uBloom: { value: opts.bloom ? BLOOM_STRENGTH : 0 },
    uAo: { value: opts.ao ? AO_STRENGTH : 0 },
    uAoRadius: { value: AO_RADIUS },
    uVignette: { value: VIGNETTE },
    uAberration: { value: 0 },
    uFlash: { value: 0 },
    // MUST track the render target. A stale uResolution silently misaligns the
    // AO ring, the outline's neighbour taps and the scanline rows — it looks
    // like a completely different bug, so it is updated in resize() below.
    uResolution: { value: new THREE.Vector2(sizing.renderW, sizing.renderH) },
  };
  const finalMat = new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: FINAL_FRAG,
    uniforms: finalUniforms,
    depthTest: false,
    depthWrite: false,
  });

  // One reusable fullscreen quad; passes swap its material.
  const quadScene = new THREE.Scene();
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
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
      finalUniforms.uResolution.value.set(next.renderW, next.renderH);
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
    if (finalUniforms.uBloom.value > 0.001) {
      brightMat.uniforms.tSrc.value = sceneTarget.texture;
      blit(brightMat, bloomA);

      blurMat.uniforms.tSrc.value = bloomA.texture;
      blurMat.uniforms.uDir.value.set(BLOOM_RADIUS / BW, 0);
      blit(blurMat, bloomB);

      blurMat.uniforms.tSrc.value = bloomB.texture;
      blurMat.uniforms.uDir.value.set(0, BLOOM_RADIUS / BH);
      blit(blurMat, bloomA); // final blurred bloom lands back in bloomA
    }

    // 3. Composite + cel quantize → screen.
    blit(finalMat, null);
  }

  resize();

  return {
    target: sceneTarget,
    render,
    resize,
    setQuantize: (on) => {
      finalUniforms.uQuantize.value = on ? 1 : 0;
    },
    setDither: (on) => {
      finalUniforms.uDither.value = on ? 1 : 0;
    },
    setScanline: (on) => {
      finalUniforms.uScanline.value = on ? 1 : 0;
    },
    setOutline: (on) => {
      finalUniforms.uOutline.value = on ? 1 : 0;
    },
    setBloom: (on) => {
      finalUniforms.uBloom.value = on ? BLOOM_STRENGTH : 0;
    },
    setAo: (on) => {
      finalUniforms.uAo.value = on ? AO_STRENGTH : 0;
    },
    setFrenzyFx: (intensity) => {
      const t = Math.max(0, Math.min(1, intensity));
      finalUniforms.uVignette.value = VIGNETTE + (FRENZY_VIGNETTE - VIGNETTE) * t;
      finalUniforms.uAberration.value = FRENZY_ABERRATION * t;
    },
    setFlash: (intensity) => {
      finalUniforms.uFlash.value = Math.max(0, Math.min(1, intensity));
    },
    dispose: () => {
      depthTexture.dispose();
      sceneTarget.dispose();
      bloomA.dispose();
      bloomB.dispose();
      quadGeo.dispose();
      brightMat.dispose();
      blurMat.dispose();
      finalMat.dispose();
    },
  };
}
