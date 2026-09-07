import type * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';

/** Compile every set before the story clock starts, including hidden arcade
 * and title geometry. Otherwise their first visible frame pays for shaders. */
export async function warmIntro(renderer: Pick<WebGPURenderer, 'compileAsync'>, scene: THREE.Scene, camera: THREE.Camera): Promise<void> {
  const saved: Array<[THREE.Object3D, boolean, boolean]> = [];
  scene.traverse(object => {
    saved.push([object, object.visible, object.frustumCulled]);
    object.visible = true;
    object.frustumCulled = false;
  });
  try {
    await renderer.compileAsync(scene, camera);
  } catch (error) {
    console.warn('[pinball-knight] Intro warm-up failed; compiling on first draw', error);
  } finally {
    for (const [object, visible, culled] of saved) {
      object.visible = visible;
      object.frustumCulled = culled;
    }
  }
}
