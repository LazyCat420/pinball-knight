/**
 * The pixel pipeline — this is what makes 3D geometry read as 8-bit.
 *
 *   scene ──▶ WebGLRenderTarget (320x180, NearestFilter, linear colour)
 *                        │
 *                        ▼
 *          fullscreen quad, custom ShaderMaterial
 *          ├─ linear → sRGB (we do this by hand, see below)
 *          ├─ Bayer 4x4 ordered dither
 *          ├─ snap to nearest of 32 palette colours (luma-weighted)
 *          └─ optional scanlines
 *                        │
 *                        ▼
 *                  canvas (integer-scaled)
 *
 * COLOUR MANAGEMENT — read before touching this.
 * The render target uses the default (no) colour space, so three.js writes
 * LINEAR values into it. We convert linear→sRGB ourselves in the shader and
 * compare against the sRGB palette. We must NOT let three.js do an output
 * conversion on the quad too, or it'd double-encode — which it won't, because
 * a custom ShaderMaterial that doesn't `#include <colorspace_fragment>` gets no
 * injected conversion. Tone mapping is off (NoToneMapping): we want flat,
 * banded colour, not a filmic curve.
 *
 * PIXEL GRID — the render target is a FIXED 320x180 regardless of window size.
 * Only the upscale factor changes. If the internal resolution tracked the
 * window, the art would "breathe" as you resize and the illusion would die.
 */
import * as THREE from "three";
import { PALETTE_SIZE, paletteToFloatArray } from "./palette";
import { RENDER_W, RENDER_H, INTEGER_SCALE } from "../constants";

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;

uniform sampler2D tDiffuse;
uniform vec3  uPalette[${PALETTE_SIZE}];
uniform float uQuantize;
uniform float uDither;
uniform float uScanline;
uniform vec2  uResolution;

varying vec2 vUv;

// Accurate linear → sRGB transfer.
vec3 linearToSRGB(vec3 c) {
  c = max(c, vec3(0.0));
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

// Compact Bayer 4x4 — returns [0,1). The classic recursive formulation:
// bayer2 gives the 2x2 pattern, and bayer4 nests it at quarter weight.
float bayer2(vec2 a) {
  a = floor(a);
  return fract(a.x / 2.0 + a.y * a.y * 0.75);
}
float bayer4(vec2 a) {
  return bayer2(0.5 * a) * 0.25 + bayer2(a);
}

void main() {
  vec3 col = linearToSRGB(texture2D(tDiffuse, vUv).rgb);

  // Nudge each pixel up or down the ramp before snapping. This is what buys back
  // apparent colour depth — without it, smooth gradients snap into hard bands,
  // and a torch's radial falloff becomes a set of concentric rings on the floor
  // that look like ripples in a pond rather than light.
  //
  // The magnitude needs to be around one palette step to actually break a band.
  // Too low and the rings survive; too high and everything looks sandblasted.
  if (uDither > 0.5) {
    float b = bayer4(gl_FragCoord.xy) - 0.5;
    col += b * (2.0 / float(${PALETTE_SIZE}));
  }

  // Snap to the nearest palette entry. Distance is luma-weighted rather than
  // naive Euclidean — the eye is far more sensitive to green than to blue, and
  // weighting for that noticeably improves which colour gets picked.
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
  dispose(): void;
}

export function createPixelPass(
  renderer: THREE.WebGLRenderer,
  opts: { quantize: boolean; dither: boolean; scanline: boolean },
): PixelPass {
  // We want fat honest pixels, so devicePixelRatio is deliberately ignored.
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.NoToneMapping;

  const target = new THREE.WebGLRenderTarget(RENDER_W, RENDER_H, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
    depthBuffer: true,
    stencilBuffer: false,
  });

  const uniforms = {
    tDiffuse: { value: target.texture },
    uPalette: { value: paletteToFloatArray() },
    uQuantize: { value: opts.quantize ? 1 : 0 },
    uDither: { value: opts.dither ? 1 : 0 },
    uScanline: { value: opts.scanline ? 1 : 0 },
    uResolution: { value: new THREE.Vector2(RENDER_W, RENDER_H) },
  };

  const quadMat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });

  // A single triangle-pair in clip space. No EffectComposer dependency needed
  // for one pass — this is the whole postprocessing stack.
  const quadScene = new THREE.Scene();
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadGeo = new THREE.PlaneGeometry(2, 2);
  quadScene.add(new THREE.Mesh(quadGeo, quadMat));

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
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, camera);

    renderer.setRenderTarget(null);
    renderer.render(quadScene, quadCam);
  }

  resize();

  return {
    target,
    render,
    resize,
    setQuantize: (on) => {
      uniforms.uQuantize.value = on ? 1 : 0;
    },
    setDither: (on) => {
      uniforms.uDither.value = on ? 1 : 0;
    },
    setScanline: (on) => {
      uniforms.uScanline.value = on ? 1 : 0;
    },
    dispose: () => {
      target.dispose();
      quadGeo.dispose();
      quadMat.dispose();
    },
  };
}
