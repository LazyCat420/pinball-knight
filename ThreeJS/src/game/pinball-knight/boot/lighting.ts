/**
 * The dungeon's lighting rig — build, per-depth tint, per-frame follow, and the
 * 30 Hz shadow throttle.
 *
 * Extracted from core.ts, where `sun`/`lamp`/`ambient`/`hemi` were four
 * module-level `let`s poked by four unrelated places (launch, startLevel's
 * biome re-tint, the frame loop, teardown). They live here now with the code
 * that touches them, so the rig has ONE owner instead of four writers.
 *
 * Presentation-only, and deliberately NOT on `state`: the whole rig is rebuilt
 * on every launch and freed with the scene.
 */
import * as THREE from "three";
import { state } from "../state";
import {
  AMBIENT_INTENSITY,
  HEMI_INTENSITY,
  PLAYER_LAMP_INTENSITY,
  PLAYER_LAMP_RANGE,
  DIR_INTENSITY,
  DIR_HEIGHT,
  SHADOW_MAP_SIZE,
  SHADOW_AREA,
  SHADOW_OPACITY,
} from "../constants";

/** A depth's colour family — the FF dungeon trick: deeper floors shift palette. */
export interface BiomeTint {
  amb: number;
  sky: number;
  ground: number;
}

let sun: THREE.DirectionalLight | null = null;
let lamp: THREE.PointLight | null = null;
let ambient: THREE.AmbientLight | null = null;
let hemi: THREE.HemisphereLight | null = null;

/** Parity counter for the 30 Hz shadow-map throttle. */
let shadowFrameCounter = 0;

/**
 * Build the rig into `state.scene`. `tint` is biome 0 — startLevel re-tints per
 * depth through `tintLights`.
 */
export function buildLights(tint: BiomeTint): void {
  const scene = state.scene;
  if (!scene) return;

  // Cold slate fill. This is the colour the dungeon IS — torches and the key
  // light are accents on top of it. With real normal maps and a directional
  // key doing the shaping, ambient's job is the READABILITY floor: it can't
  // bottom out to pure black or the quantizer snaps stone to void.
  // (Colours are re-tinted per depth in startLevel.)
  ambient = new THREE.AmbientLight(tint.amb, AMBIENT_INTENSITY);
  scene.add(ambient);

  // A little vertical shape, so wall tops separate from wall faces.
  hemi = new THREE.HemisphereLight(tint.sky, tint.ground, HEMI_INTENSITY);
  scene.add(hemi);

  // The hero's personal lamp — the Castlevania readability rule: whatever
  // else is dark, the player and the tiles around them always read.
  lamp = new THREE.PointLight(0xd9cba8, PLAYER_LAMP_INTENSITY, PLAYER_LAMP_RANGE, 2);
  scene.add(lamp);

  // The cold key light — a high, raking directional that casts the wall
  // shadows into the corridors. Its ortho shadow frustum is small and follows
  // the camera target each frame (see followPlayer), so a 2k map stays crisp
  // over the whole visible area instead of being stretched across the maze.
  sun = new THREE.DirectionalLight(0xa7c0e0, DIR_INTENSITY);
  sun.castShadow = true;
  // 30 Hz shadows — the loop re-flags shadow.needsUpdate on alternate frames.
  // Must be per-light: WebGPURenderer has no renderer-level shadowMap.autoUpdate.
  sun.shadow.autoUpdate = false;
  sun.shadow.needsUpdate = true;
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = DIR_HEIGHT * 2.5;
  sun.shadow.camera.left = -SHADOW_AREA;
  sun.shadow.camera.right = SHADOW_AREA;
  sun.shadow.camera.top = SHADOW_AREA;
  sun.shadow.camera.bottom = -SHADOW_AREA;
  sun.shadow.bias = -0.0009; // kill the shadow-acne the coursed normal maps would otherwise show
  sun.shadow.normalBias = 0.04;
  // Soften the shadow so it snaps to a stone step, not pure void.
  sun.shadow.intensity = 1 - SHADOW_OPACITY;
  scene.add(sun);
  scene.add(sun.target); // target is moved each frame; must be in the graph
}

/** Depth grading: each biome down shifts the fill palette a family over. */
export function tintLights(tint: BiomeTint): void {
  ambient?.color.setHex(tint.amb);
  if (hemi) {
    hemi.color.setHex(tint.sky);
    hemi.groundColor.setHex(tint.ground);
  }
}

/**
 * Keep the key light's small shadow frustum centred on the player: the light
 * rakes in from the world's north-west (opposite the south-east camera) so
 * wall shadows fall toward the viewer, into the corridors, not away.
 */
export function followPlayer(x: number, z: number): void {
  if (sun) {
    sun.target.position.set(x, 0, z);
    sun.position.set(x - DIR_HEIGHT * 0.55, DIR_HEIGHT, z - DIR_HEIGHT * 0.55);
  }
  if (lamp) lamp.position.set(x, 1.3, z);
}

/**
 * Flag every shadow-casting light for a depth-pass re-render.
 *
 * THE THROTTLE IS PER-LIGHT, NOT PER-RENDERER. WebGPURenderer.shadowMap is only
 * { enabled, transmitted, type } — it has no autoUpdate/needsUpdate, so the old
 * renderer-level flags would have gone SILENTLY dead and shadows would quietly
 * re-render every frame. three's WebGPU path gates on the light instead
 * (nodes/lighting/ShadowNode.js: `shadow.needsUpdate || shadow.autoUpdate`).
 */
export function setShadowsThrottled(needsUpdate: boolean): void {
  state.scene?.traverse((o) => {
    const l = o as THREE.Light & { shadow?: THREE.LightShadow };
    if (l.isLight && l.shadow) l.shadow.needsUpdate = needsUpdate;
  });
}

/** Per-frame: re-render the shadow depth pass on alternate frames only. */
export function tickShadowThrottle(): void {
  shadowFrameCounter++;
  if (shadowFrameCounter % 2 === 0) setShadowsThrottled(true);
}

/** Teardown. The lights themselves are freed with the scene by disposeAll. */
export function clearLights(): void {
  sun = null;
  lamp = null;
  ambient = null;
  hemi = null;
  shadowFrameCounter = 0;
}
