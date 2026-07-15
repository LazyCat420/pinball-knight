/**
 * The pixel/cel post pipeline — this is what makes 3D geometry read as a
 * flat-banded, ink-outlined cel picture, now with real depth cues.
 *
 *   scene ──▶ sceneTarget (1280x720, Nearest, LINEAR colour, + depth texture)
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
 * PIXEL GRID — sceneTarget is a FIXED 1280x720 regardless of window size. Only
 * the upscale factor changes, so the art never "breathes" as you resize.
 */
import * as THREE from "three";
import { PALETTE_SIZE, paletteToFloatArray } from "./palette";
import {
  RENDER_W,
  RENDER_H,
  INTEGER_SCALE,
  BLOOM_THRESHOLD,
  BLOOM_STRENGTH,
  BLOOM_RADIUS,
  AO_RADIUS,
  AO_STRENGTH,
  VIGNETTE,
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
  vec3 col = texture2D(tDiffuse, vUv).rgb; // LINEAR scene

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

export interface PixelPass {
  target: THREE.WebGLRenderTarget;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  /** Recompute the canvas size for a new window size. Never changes the RT. */
  resize(): void;
  setQuantize(on: boolean): void;
  setDither(on: boolean): void;
  setScanline(on: boolean): void;
  setOutline(on: boolean): void;
  setBloom(on: boolean): void;
  setAo(on: boolean): void;
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

  // The depth texture feeds the outline and AO passes.
  const depthTexture = new THREE.DepthTexture(RENDER_W, RENDER_H);
  depthTexture.type = THREE.UnsignedIntType;

  const sceneTarget = new THREE.WebGLRenderTarget(RENDER_W, RENDER_H, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
    depthBuffer: true,
    stencilBuffer: false,
    depthTexture,
  });

  // Bloom works at half resolution — cheaper, and a wider blur for free.
  const BW = Math.floor(RENDER_W / 2);
  const BH = Math.floor(RENDER_H / 2);
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
    uResolution: { value: new THREE.Vector2(RENDER_W, RENDER_H) },
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

    let outW: number;
    let outH: number;

    if (INTEGER_SCALE) {
      const scale = Math.max(1, Math.floor(Math.min(winW / RENDER_W, winH / RENDER_H)));
      outW = RENDER_W * scale;
      outH = RENDER_H * scale;
    } else {
      const scale = Math.min(winW / RENDER_W, winH / RENDER_H);
      outW = Math.round(RENDER_W * scale);
      outH = Math.round(RENDER_H * scale);
    }

    renderer.setSize(outW, outH, false);

    // Centre the canvas; the black container shows through as letterbox bars.
    const el = renderer.domElement;
    el.style.width = `${outW}px`;
    el.style.height = `${outH}px`;
    el.style.position = "absolute";
    el.style.left = `${Math.floor((winW - outW) / 2)}px`;
    el.style.top = `${Math.floor((winH - outH) / 2)}px`;
    el.style.imageRendering = "pixelated";
  }

  function render(scene: THREE.Scene, camera: THREE.Camera): void {
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
