/**
 * POKÉMON-STYLE HOLOGRAPHIC FOIL SHADER (TSL / MeshBasicNodeMaterial)
 *
 * Implements an authentic physical holographic trading card effect for Three.js
 * under WebGPURenderer:
 *   1. Angle-dependent rainbow spectral dispersion (diffraction grating).
 *   2. Cosmic / galaxy four-point star glitter grid (twinkling star foil).
 *   3. Selective foil masking (100% art window, metallic border accents, 0% text).
 *   4. Pointer-tracked glossy specular glare sweep.
 *
 * Compatible with WebGPURenderer (NodeMaterial pipeline) across WebGPU and WebGL2.
 */
import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  abs,
  cos,
  dot,
  float,
  floor,
  fract,
  length,
  max,
  min,
  mix,
  pow,
  sin,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

export interface HoloCardMaterialOptions {
  isShiny?: boolean;
  rarityTier?: number;
}

export interface HoloCardMaterialInstance {
  material: MeshBasicNodeMaterial;
  texture: THREE.CanvasTexture;
  uTime: ReturnType<typeof uniform>;
  uPointer: ReturnType<typeof uniform>;
  uTilt: ReturnType<typeof uniform>;
  uHoloIntensity: ReturnType<typeof uniform>;
  dispose(): void;
}

export function createHoloCardMaterial(
  sourceCanvas: HTMLCanvasElement,
  options: HoloCardMaterialOptions = {},
): HoloCardMaterialInstance {
  const cardTexture = new THREE.CanvasTexture(sourceCanvas);
  cardTexture.colorSpace = THREE.SRGBColorSpace;
  cardTexture.minFilter = THREE.LinearFilter;
  cardTexture.magFilter = THREE.LinearFilter;

  const uTime = uniform(0);
  const uPointer = uniform(new THREE.Vector2(0, 0));
  const uTilt = uniform(new THREE.Vector2(0, 0));

  // Default foil intensity: 1.0 for shiny, 0.55 for mythic (tier 4), 0.35 for legendary (tier 3), 0 for plain
  const defaultIntensity = options.isShiny
    ? 1.0
    : options.rarityTier && options.rarityTier >= 4
      ? 0.55
      : options.rarityTier === 3
        ? 0.35
        : 0.0;
  const uHoloIntensity = uniform(defaultIntensity);

  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.side = THREE.DoubleSide;

  const cardTex = texture(cardTexture);
  const uvs = uv();

  // 1. SELECTIVE FOIL MASK
  // Art window in 512x716 card coordinates:
  // x: 30..482 => u: 0.058..0.941
  // y: 88..408 (from top) => v: 0.430..0.877 (from bottom)
  const inArtX = smoothstep(float(0.055), float(0.065), uvs.x).mul(
    smoothstep(float(0.945), float(0.935), uvs.x),
  );
  const inArtY = smoothstep(float(0.428), float(0.438), uvs.y).mul(
    smoothstep(float(0.880), float(0.870), uvs.y),
  );
  const artMask = inArtX.mul(inArtY);

  // Subtle border foil accents for legendary/mythic
  const borderMask = float(1.0).sub(artMask).mul(float(0.25));
  const foilMask = artMask.add(borderMask).mul(uHoloIntensity);

  // 2. SPECTRAL RAINBOW DISPERSION
  // Shifts diagonally across the surface based on UVs and tilt angle
  const diag = uvs.x.mul(1.2).add(uvs.y.mul(0.85));
  const angleShift = uTilt.x.mul(1.8).add(uTilt.y.mul(1.2));
  const hue = fract(diag.add(angleShift).add(uTime.mul(0.04)));

  const r = cos(hue.mul(6.28318)).mul(0.5).add(0.5);
  const g = cos(hue.add(0.33).mul(6.28318)).mul(0.5).add(0.5);
  const b = cos(hue.add(0.67).mul(6.28318)).mul(0.5).add(0.5);
  const rainbowCol = vec3(r, g, b);

  // 3. COSMIC / GALAXY SPARKLE GRID
  const gridUv = uvs.mul(75.0);
  const cell = floor(gridUv);
  const f = fract(gridUv).sub(0.5);

  const h1 = fract(sin(dot(cell, vec2(127.1, 311.7))).mul(43758.5453));
  const h2 = fract(sin(dot(cell, vec2(269.5, 183.3))).mul(43758.5453));

  const sparklePhase = fract(h1.add(uTilt.x.mul(2.5)).add(uTilt.y.mul(2.5)).add(uTime.mul(0.18)));
  const glint = pow(max(float(0.0), float(1.0).sub(abs(sparklePhase.sub(0.5)).mul(4.0))), float(16.0));

  const d = length(f);
  const crossD = min(abs(f.x), abs(f.y));
  const starShape = smoothstep(float(0.35), float(0.0), d).add(
    smoothstep(float(0.08), float(0.0), crossD).mul(smoothstep(float(0.45), float(0.0), d)),
  );
  const sparkle = glint.mul(starShape).mul(h2.mul(0.8).add(0.2));

  // 4. SPECULAR GLARE BAR
  const glarePos = uvs.x.add(uvs.y.mul(0.5));
  const mousePos = uPointer.x.mul(0.5).add(uPointer.y.mul(0.25)).add(0.75);
  const glareDist = abs(glarePos.sub(mousePos));
  const glare = pow(max(float(0.0), float(1.0).sub(glareDist.mul(1.5))), float(6.0)).mul(0.6);

  // 5. BLEND COMPOSITION
  const colorWithRainbow = mix(cardTex.rgb, cardTex.rgb.add(rainbowCol.mul(0.65)), foilMask);
  const colorWithSparkles = colorWithRainbow.add(vec3(1.0, 0.95, 0.88).mul(sparkle.mul(foilMask).mul(2.4)));
  const finalColor = colorWithSparkles.add(vec3(1.0, 1.0, 1.0).mul(glare.mul(0.42)));

  material.colorNode = vec4(finalColor, cardTex.a);

  return {
    material,
    texture: cardTexture,
    uTime,
    uPointer,
    uTilt,
    uHoloIntensity,
    dispose: () => {
      material.dispose();
      cardTexture.dispose();
    },
  };
}
