/**
 * Floor pipeline WARM-UP — compile this floor's shaders while the descent
 * screen is up, instead of hitching mid-fight when each effect first fires.
 *
 * Extracted verbatim from core.ts. It knows nothing about the game: it is a
 * scene, a camera and a progress bar. The two long docblocks below are the
 * measured reasons this is shaped the way it is — one about WHICH units to
 * compile, one about WHEN to tick the bar — and both cost a real profiling
 * session to learn. They travel with the code.
 */
import * as THREE from "three";
import { state } from "../state";
import { warmFloorFxReveal } from "../entities/floor-fx";
import { setShadowsThrottled } from "./lighting";
import type { FloorLoading } from "../floor-loading";

/**
 * Compile this floor's render pipelines while the descent screen is up.
 *
 * Done per top-level scene child rather than in one `compileAsync(scene)` call
 * so the bar reports real progress instead of sitting at 30% for six seconds.
 * The three-argument form is the documented way to precompile a loose 3D object
 * ("if the first argument is a 3D object, targetScene must represent the scene
 * the object is going to be added to") and it keeps the pipeline cache keys
 * matching the ones `render()` will look up.
 *
 * Sequential, never concurrent: compileAsync saves and restores renderer state
 * around itself, so two in flight at once clobber each other's render context.
 *
 * THE HIDDEN HALF. compileAsync walks `_projectObject`, which returns early on
 * `object.visible === false` and frustum-tests meshes (three:
 * common/Renderer.js). Every pooled effect — slash, bolt, ring, blade, sigil,
 * damage number — is built INVISIBLE, and the dash ghost and the five floor-fx
 * decal materials are not built until they are first used. So for a long time
 * this function walked right past all of them, and the first of each in a run
 * still compiled cold, mid-fight, which is precisely the stall it exists to
 * prevent. The two reveals below put one representative of each into the walk;
 * pipelines are keyed by material content, so one warms the whole pool.
 */
/**
 * Split the scene into units small enough that compiling one is a tickable step.
 *
 * ── WHY THIS IS NOT JUST `scene.children` ──
 *
 * `compileAsync` is awaited per unit, and the descent bar can only advance
 * BETWEEN awaits. So the bar's smoothness is bounded by the LARGEST unit, not
 * by how many there are. Measured cold on a real GPU (nvidia/ampere, WebGPU
 * backend), instrumenting every call:
 *
 *     268 compileAsync calls, 4,520 ms total
 *     └─ ONE Group, 187 descendants ......... 3,915 ms   ← 87% of the whole warmup
 *        next most expensive Mesh ...........   134 ms
 *
 * That single group is the freeze. With one await covering 87% of the work the
 * bar necessarily sits on one number for ~4 s and then sweeps the rest
 * instantly — "smooth until it sticks near the end, then lags hard". Ticking
 * before the await (see the loop below) fixed WHERE the number stalls but could
 * not fix the stall itself, because there was nothing to tick between.
 *
 * So a group that big is expanded into its children and those become the units.
 * The threshold is a size, not a name: whichever group happens to be the maze
 * this build is not something to hard-code.
 *
 * Depth is capped at one expansion. Recursing to individual meshes would make
 * hundreds of tiny awaits whose scheduling overhead exceeds the compile, and
 * pipelines are keyed by material content anyway — the win is in breaking up
 * the one pathological group, not in maximal granularity.
 */
export function warmUnits(scene: THREE.Scene): THREE.Object3D[] {
  /** Above this many descendants, a single await is too coarse to report on. */
  const SPLIT_ABOVE = 24;
  const units: THREE.Object3D[] = [];
  for (const child of scene.children) {
    let n = 0;
    child.traverse(() => n++);
    if (n > SPLIT_ABOVE && child.children.length > 1) units.push(...child.children);
    else units.push(child);
  }
  return units;
}

/**
 * Draw one COMPLETE frame — post-process chain, shadow depth pass and all —
 * while the descent screen still covers the display.
 *
 * ── WHY compileAsync IS NOT ENOUGH ──
 *
 * `compileAsync` warms the pipelines for the objects it walks, as seen from the
 * camera it is handed. It does not warm the SHADOW pass, and it does not build
 * everything the real render path touches. Measured on a real GPU with a V8
 * sampling profile sliced to the hitch frames (`scripts/lag-profile.mjs`), the
 * single worst frame of a 30 s run — 970 ms, and the FIRST frame after the
 * descent screen closed, so the player sees the floor appear and then freeze —
 * was three's NodeBuilder building shader graphs, alongside
 * `createRenderPipeline renderPipeline_ShadowMaterial_930` ×20. Twenty shadow
 * pipelines, created after a warm-up whose entire job is to have created them.
 *
 * A render is the only thing that provably warms what a render needs. It costs
 * the same time it was going to cost anyway; the difference is that here it is
 * spent under a progress bar rather than on the first frame of play.
 *
 * TWO frames, not one: `tickShadowThrottle` re-renders the shadow depth pass on
 * alternate frames, so a single warm frame can land on the half that skips it —
 * which is exactly the case this exists to cover. `setShadowsThrottled(true)`
 * forces the first one rather than relying on the counter's parity.
 */
async function warmFirstFrame(): Promise<void> {
  const { renderer, scene, camera, pixelPass } = state;
  if (!renderer || !scene || !camera || !pixelPass) return;
  for (let i = 0; i < 2; i++) {
    setShadowsThrottled(true);
    pixelPass.render(scene, camera);
    // Let the GPU actually retire the work before the second pass, and give the
    // descent screen's own rAF a turn so the bar is not frozen at 100%.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }
}

export async function warmFloorPipelines(load: FloorLoading): Promise<void> {
  const renderer = state.renderer;
  const scene = state.scene;
  const camera = state.camera;
  if (!renderer || !scene || !camera) return;
  // Reveal BEFORE snapshotting children: the floor-fx proxies parent themselves
  // to the scene here, and must be in the list the loop iterates.
  const restoreVfx = state.vfx?.warmupReveal();
  const restoreFloorFx = warmFloorFxReveal(scene);
  // ── THE OTHER HALF OF THE HIDDEN HALF ──
  //
  // `compileAsync` walks `_projectObject`, which FRUSTUM-TESTS every mesh
  // (three: common/Renderer.js). The camera sees ~20x11 tiles of a ~4000-tile
  // floor, so the warm-up was compiling the fraction of the floor that happened
  // to be on screen at the spawn point and skipping the rest — and the rest
  // then compiled lazily, mid-play, the moment the player walked into view of
  // it.
  //
  // Measured before this (real WebGPU, nvidia/ampere, 40s bot run): programs
  // climbed 2 -> 129, with 62 of them compiling in ONE 628ms frame at 4.3s,
  // after the descent screen had already closed, plus 479/578/618ms frames
  // behind it and a trickle at 18.8s / 24.5s / 31.7s as the bot reached new
  // parts of the maze. 12.3% of frames missed 60Hz.
  //
  // Turning culling off for the duration makes the walk visit everything. It is
  // restored in the `finally` below — leaving it off would make the whole maze
  // draw every frame forever, trading a load stall for a permanent one.
  const culling: Array<[THREE.Object3D, boolean]> = [];
  scene.traverse((o) => {
    if (o.frustumCulled) {
      culling.push([o, o.frustumCulled]);
      o.frustumCulled = false;
    }
  });
  const children = warmUnits(scene);
  const CAPTIONS = ["FORGING THE MACHINE", "LIGHTING THE TORCHES", "WAKING THE HORDE", "SETTING THE TABLE"];
  try {
    for (let i = 0; i < children.length; i++) {
      // ── TICK BEFORE THE AWAIT, NOT AFTER ──
      //
      // The old loop reported progress only every 16th child, AFTER its compile
      // resolved. That assumed every child costs about the same. Measured on a
      // real GPU (nvidia/ampere, WebGPU backend) it is nowhere near:
      //
      //     0% → 30%   294 ms   (buildLevel)
      //    30% → 34%  1424 ms   ← the FIRST compile batch, one single tick
      //    34% → 100%   ~90 ms   (the other 16 batches, a tick each)
      //
      // Cold, that first plateau was ~8.3 s. So the bar spent almost the entire
      // descent frozen on one number while the expensive batch ran, then swept
      // through the cheap remainder — which is exactly the "smooth until it
      // sticks near the end, then lags hard" report. The bar was not lying about
      // being nearly done; it simply could not move during the one wait that
      // mattered.
      //
      // Ticking first means the number on screen is always the work IN FLIGHT.
      // The DOM write is not the expense the old comment feared either: these
      // are ~17 writes across a multi-second descent, and `phase()` early-outs
      // once closed.
      const f = i / children.length;
      load.phase(CAPTIONS[Math.min(CAPTIONS.length - 1, Math.floor(f * CAPTIONS.length))], 0.3 + 0.7 * f);
      await renderer.compileAsync(children[i], camera, scene);
    }
    load.phase(CAPTIONS[CAPTIONS.length - 1], 1);
    await warmFirstFrame();
  } catch {
    // A failed precompile is a slow first frame, not a broken floor — the
    // renderer will compile lazily exactly as it did before. Never strand the
    // player behind the descent screen over it.
  } finally {
    // Non-negotiable: leaving a pool slot visible parks a stray quad in the
    // world for the whole floor, so this runs even if the compile threw.
    restoreVfx?.();
    restoreFloorFx();
    for (const [o, was] of culling) o.frustumCulled = was;
  }
}
