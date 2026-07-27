/**
 * The engine's own state — the handful of fields the engine both READS and
 * WRITES, extracted from the game's `state` singleton.
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 *
 * Before the extraction, `camera.ts` and `juice.ts` imported the game's
 * `state` object directly and mutated `state.camX`, `state.shakeT`,
 * `state.hitstopT`. That is the dependency that made the "engine" not an
 * engine: you could not run the camera without dragging in a 1240-line
 * singleton describing knights, zombies and pinball parts.
 *
 * The naive inversion — thread state through every call — was rejected: it
 * would have changed the signature of functions called from hundreds of
 * sites, including 33 in the tavern scene, for no behavioural gain.
 *
 * Instead the engine OWNS these fields, and the game's `state` delegates to
 * them via accessors (see `state.ts`). So:
 *
 *   - `state.camX` still reads and writes, exactly as before — no call site
 *     changed, and the tavern is untouched.
 *   - The engine no longer imports the game. `engine/` has zero imports from
 *     game content, which is the property that makes it reusable.
 *
 * The delegation is deliberate and load-bearing. Do NOT "simplify" it by
 * copying values between the two: two copies of a camera position drift, and
 * the drift shows up as a camera that lags the player by one frame.
 */
import type * as THREE from "three";
import type { WebGPURenderer } from "three/webgpu";

/**
 * Fields the engine owns. The game reaches these through `state`, never
 * directly — that indirection is what lets the engine stay game-agnostic.
 */
export interface ViewState {
  /** The renderer, once booted. Null before boot and after dispose. */
  renderer: WebGPURenderer | null;
  /** The scene root. */
  scene: THREE.Scene | null;
  /** The active orthographic camera. */
  camera: THREE.OrthographicCamera | null;
  /** Camera follow target — where the camera is looking, on the ground plane. */
  camX: number;
  camZ: number;
  /** Seconds of screen shake remaining. Decays in the follow-camera update. */
  shakeT: number;
  /** Hit-freeze: while > 0 the fixed-step sim is paused (VFX/render keep going). */
  hitstopT: number;
}

/** The single live instance. */
export const view: ViewState = {
  renderer: null,
  scene: null,
  camera: null,
  camX: 0,
  camZ: 0,
  shakeT: 0,
  hitstopT: 0,
};

/**
 * Clear the engine's view state.
 *
 * Note this nulls the three.js handles as well as the scalars: it is called
 * from the game's `resetState`, which runs on dispose as well as on restart,
 * and a retained renderer reference after dispose leaks the GPU context.
 */
export function resetView(): void {
  view.renderer = null;
  view.scene = null;
  view.camera = null;
  view.camX = 0;
  view.camZ = 0;
  view.shakeT = 0;
  view.hitstopT = 0;
}

/**
 * Reset only the per-run scalars, leaving the renderer/scene/camera in place.
 * Used between floors, where the GPU objects are reused.
 */
export function resetViewScalars(): void {
  view.camX = 0;
  view.camZ = 0;
  view.shakeT = 0;
  view.hitstopT = 0;
}
