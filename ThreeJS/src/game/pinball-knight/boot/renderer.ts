/**
 * The renderer and the pixel pass.
 *
 * Extracted verbatim from `launchDungeonGame`. Two comments in here cost real
 * debugging and must not be summarised away: the ASYNC-INIT gate (why
 * `launchDungeonGame` can stay synchronous) and the note that the shadow
 * throttle is PER-LIGHT, not per-renderer.
 *
 * ## Why `rendererReady` lives here now
 *
 * It is set in this block and read by the render gate in `loop()`. Rather than
 * leave a module `let` behind in core.ts for a flag this file owns, the flag
 * moves with the code and core reads it through `isRendererReady()`. That keeps
 * "who decides the renderer is usable" in one file — which is the whole point
 * of the split, and cheaper than an exported mutable binding.
 */
import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import { selectBackend, createGPURenderer } from "../../../render/backend";
import { state } from "../state";
import { createPixelPass } from "../engine/render/pixel-pass";
import { PALETTE_HEX } from "../render/palette";
import { BLOOM_DEFAULT, AO_DEFAULT, CEL_DEFAULT } from "../constants";
import { uiTexture, syncSize } from "../gui/layer";
import { installUiInput } from "../gui/input";
import { drawUiFrame } from "../gui/root";

/**
 * Whether to arm GPU timestamp queries this session.
 *
 * `?profile=1` asks for them; `?playtest=1` implies it so the headless harness
 * always collects them without every caller having to remember the flag.
 */
export function gpuTimingWanted(): boolean {
  if (typeof window === "undefined") return false;
  const q = new URLSearchParams(window.location.search);
  return q.get("profile") === "1" || q.get("playtest") === "1";
}

/**
 * False until `WebGPURenderer.init()` resolves — `render()` THROWS before that.
 *
 * Never reset on teardown, exactly as before: a new `installRenderer()` sets it
 * false again on the way in, so there is no window where a stale `true` could
 * let a frame render against a disposed backend.
 */
let rendererReady = false;
let initPromise: Promise<void> | null = null;

/** Whether the backend has finished initialising and `render()` is safe. */
export function isRendererReady(): boolean {
  return rendererReady;
}

/** Resolves when the shared backend has finished initialising. */
export function whenRendererReady(): Promise<void> {
  if (rendererReady) return Promise.resolve();
  return initPromise ?? Promise.resolve();
}

/**
 * Push ONE frame of pure UI to the screen, right now.
 *
 * The escape hatch for every moment the game must show a screen without drawing
 * the world: the descent, where the frame loop is deliberately held while a
 * floor's pipelines compile (`run/floor-hold.ts`), and the two frames
 * `armFloorLoading` buys before it blocks the thread inside `buildLevel`.
 *
 * Safe to call at any time — it no-ops before the backend resolves and when
 * there is no pass — so callers never have to reason about boot ordering.
 * Returns whether a frame actually went out, which is what the tests assert on:
 * "the screen was raised" and "a frame carrying it reached the screen" are
 * different claims, and only the second one is the bug this repo had.
 */
export function presentUiFrame(): boolean {
  if (!rendererReady || !state.pixelPass) return false;
  state.pixelPass.presentUi();
  return true;
}

/**
 * Build the renderer, attach it to the container, and build the pixel pass.
 *
 * MUST run after `installEngine()` and after settings are applied: the pixel
 * pass reads the saved look at construction.
 */
export function installRenderer(): void {
  // ── Renderer ──
  // No MSAA: the quantize pass flattens colour anyway, and the depth-edge
  // outline wants clean depth values. Colour/tonemapping is set by createPixelPass.
  // WebGPURenderer drives BOTH backends; ?gpu=webgl forces the WebGL2 one.
  // init() is awaited by the caller (launchDungeonGame) before the first frame.
  // ── GPU TIMING ──
  // `trackTimestamp` wraps each render pass in a WebGPU timestamp query, which
  // is the ONLY way to learn what the GPU actually spent. Every timing this
  // game reported before it — `pixelPass.render`, `FRAME (total)` — brackets
  // CPU-side SUBMISSION and returns long before the GPU has finished; a heavy
  // shader and a trivial one submit in about the same time.
  //
  // Opt-in via `?profile=1` (and implied by `?playtest=1`) rather than always
  // on: the query pool costs a little memory and a resolve per frame, and a
  // player never reads the number. Silently ignored when the adapter lacks the
  // `timestamp-query` feature, so this can never fail a boot.
  state.renderer = createGPURenderer({
    antialias: false,
    alpha: false,
    trackTimestamp: gpuTimingWanted(),
  });
  // Backend creation is ASYNC, and Renderer.render() THROWS if it runs first
  // ("called before the backend is initialized"). launchDungeonGame stays sync
  // because neither caller awaits it (main.ts:328, mouse-room.ts:3053) — making
  // it async would silently reorder their teardown. So the loop skips frames
  // until this resolves; see the rendererReady gate in the render block.
  rendererReady = false;
  initPromise = state.renderer.init().then(() => {
    rendererReady = true;
  });
  state.renderer.setClearColor(PALETTE_HEX[0]);
  // One shadow-casting directional light needs the shadow map on. PCFSoft gives
  // a slightly feathered edge that survives the palette quantizer as a soft
  // band rather than a hard jagged step.
  state.renderer.shadowMap.enabled = true;
  state.renderer.shadowMap.type = THREE.PCFShadowMap;
  // The full shadow depth pass re-rendered every frame is a heavy fixed cost;
  // the loop re-flags the light on alternate frames instead (30 Hz shadows —
  // invisible under the pixel quantizer, halves the shadow pass).
  //
  // THIS THROTTLE IS PER-LIGHT, NOT PER-RENDERER. WebGPURenderer.shadowMap is
  // only { enabled, transmitted, type } — it has no autoUpdate/needsUpdate, so
  // the old renderer-level flags would have gone SILENTLY dead here and shadows
  // would quietly re-render every frame. three's WebGPU path gates on the light
  // instead (nodes/lighting/ShadowNode.js: `shadow.needsUpdate || shadow.autoUpdate`),
  // which setShadowsThrottled() below drives. See throttleShadows() in the loop.
  // The overlay is built immediately above this in launchDungeonGame; the
  // assertion documents that ordering rather than inventing a fallback.
  state.container?.appendChild(state.renderer.domElement);

  const pass = createPixelPass(state.renderer, {
    quantize: state.quantize,
    dither: state.dither,
    scanline: state.scanline,
    outline: state.outline,
    bloom: BLOOM_DEFAULT,
    ao: AO_DEFAULT,
    cel: CEL_DEFAULT,
    // The in-game UI's canvas, handed to the engine as a plain texture. This is
    // the injection `engine/purity.test.ts` requires: the engine composites it
    // without knowing what a menu is.
    uiTexture: uiTexture(),
  });
  // The layer's canvas must match the grid the pass just derived, before the
  // first frame — otherwise the first paint lands on a 1x1 canvas and the UI is
  // a single stretched texel until something triggers a resize.
  syncSize(pass.sizing());
  installUiInput();

  /**
   * COMPOSE the UI drive into `render` rather than asking the loop to call it.
   *
   * The UI texture has to be uploaded before the pass composites, and the pass
   * composites inside `render()`. Leaving that to the call site means the
   * ordering is enforced by a comment in `core.ts` — and `core.ts` is at its
   * decomposition ratchet, so the natural place to write that comment is a
   * place we are not allowed to grow. Wrapping the method puts the ordering
   * next to the injection it depends on, and makes it impossible for a future
   * caller to render without first painting.
   *
   * This is plain composition, not prototype surgery: `createPixelPass` returns
   * an object literal, so `render` is an own property like any other.
   */
  const renderScene = pass.render.bind(pass);
  pass.render = (scene, camera) => {
    drawUiFrame(pass);
    renderScene(scene, camera);
  };
  // The UI-only present takes the SAME wrapper, for the same reason: it is a
  // composite, so the layer has to be uploaded before it runs. A held frame
  // that skipped this would present whatever the UI canvas held last — which on
  // the first descent of a session is nothing at all.
  const presentUiOnly = pass.presentUi.bind(pass);
  pass.presentUi = () => {
    drawUiFrame(pass);
    presentUiOnly();
  };
  state.pixelPass = pass;
}
