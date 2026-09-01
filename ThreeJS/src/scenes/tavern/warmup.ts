/**
 * Tavern pipeline WARM-UP — compile this room's shaders in the gap between
 * `WebGPURenderer.init()` resolving and the first presented frame, instead of
 * hitching the moment a hidden prop or pooled effect first draws.
 *
 * Same bug pattern the dungeon's `boot/warmup.ts` exists for: an object that is
 * not DRAWN during a warm render never gets its GPU pipeline built — and there
 * are three ways to be invisible to a warm render (`visible = false`,
 * `InstancedMesh.count = 0`, frustum-culled). The tavern builds all of them:
 * `createVfx` makes 12 pools whose slots are all invisible, and the room hides
 * the station highlight disc, the vice rune plates and the vice emitter.
 *
 * This is deliberately a COPY of the dungeon's shape, not a call into it —
 * `warmFloorPipelines` pulls renderer/scene/camera/pixelPass from dungeon
 * module state and drives the descent screen's progress bar, neither of which
 * exists here. Only `warmUnits` is generic, so only `warmUnits` is shared.
 * Extract the rest into a common helper when a THIRD scene needs it, not now.
 */
import * as THREE from "three";
import type { WebGPURenderer } from "three/webgpu";
import { warmUnits } from "../../game/pinball-knight/boot/warmup";
import type { PixelPass } from "../../game/pinball-knight/engine/render/pixel-pass";
import type { VfxSystem } from "../../game/pinball-knight/fx/system";

export interface TavernWarmArgs {
  renderer: WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  pixelPass: PixelPass;
  vfx: VfxSystem | null;
  /** The warm draws frames; abort them if the scene was torn down mid-warm. */
  active: () => boolean;
}

/**
 * Dev/measurement escape hatch: `?tavernwarm=0` disables the warm so an A/B
 * can interleave both arms in one build with identical instrumentation.
 */
export function tavernWarmEnabled(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("tavernwarm") !== "0";
  } catch {
    return true;
  }
}

export async function warmTavern({ renderer, scene, camera, pixelPass, vfx, active }: TavernWarmArgs): Promise<void> {
  // Reveal BEFORE snapshotting units, so revealed pool slots are in the walk.
  const restoreVfx = vfx?.warmupReveal();
  // The tavern's own hidden props (highlight disc, vice plates, vice emitter)
  // have no reveal helper, so sweep the scene: show everything and suppress
  // frustum culling. Culling matters as much as visibility — `compileAsync`
  // walks `_projectObject`, which frustum-tests every mesh, and a warm that
  // only compiles what the camera happens to contain silently skips the rest.
  const saved: Array<[THREE.Object3D, boolean, boolean]> = [];
  scene.traverse((o) => {
    if (!o.visible || o.frustumCulled) {
      saved.push([o, o.visible, o.frustumCulled]);
      o.visible = true;
      o.frustumCulled = false;
    }
  });
  // Restore is called on the happy path BEFORE the warm frames (see below) and
  // again in the `finally` as a safety net, so it must be idempotent.
  let restored = false;
  const restore = (): void => {
    if (restored) return;
    restored = true;
    // Non-negotiable: leaving a pool slot visible parks a stray quad in the
    // room for the whole visit, and leaving culling off draws the whole room
    // every frame forever — restore even if the compile threw.
    restoreVfx?.();
    for (const [o, vis, cull] of saved) {
      o.visible = vis;
      o.frustumCulled = cull;
    }
  };
  try {
    // Compile one representative unit per unique material signature to avoid
    // redundant compiles of dozens of identical box/cylinder primitives.
    const seenMats = new Set<string>();
    const representativeUnits: THREE.Object3D[] = [];
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.material) {
        const matKey = Array.isArray(mesh.material)
          ? mesh.material.map((m) => m.uuid).join(",")
          : mesh.material.uuid;
        if (!seenMats.has(matKey)) {
          seenMats.add(matKey);
          representativeUnits.push(mesh);
        }
      }
    });

    for (const unit of representativeUnits.length ? representativeUnits : warmUnits(scene)) {
      if (!active()) break;
      await pixelPass.withSceneContext(() => renderer.compileAsync(unit, camera, scene));
    }
    // ── RESTORE BEFORE THE WARM FRAMES, unlike the dungeon ──
    // The dungeon draws its warm frames under the descent screen, so it can
    // keep everything revealed. The tavern's canvas is ALREADY ON SCREEN —
    // a revealed warm frame would flash every pool slot and hidden prop at
    // the player. Restoring first means the two frames below present exactly
    // what the first real frame will, and still warm what compileAsync
    // cannot: the shadow depth pass and anything the real path defers.
    restore();
    for (let i = 0; i < 2; i++) {
      if (!active()) break;
      pixelPass.render(scene, camera);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
  } catch {
    // A failed precompile is a slow first frame, not a broken room — the
    // renderer compiles lazily exactly as it did before this file existed.
  } finally {
    restore();
  }
}
