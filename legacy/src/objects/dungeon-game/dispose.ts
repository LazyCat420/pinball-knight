/**
 * Teardown. Every game here is expected to leave nothing behind — geometry,
 * materials, textures, render targets, the WebGL context and the overlay div.
 */
import { state } from "./state";
import type { Sandbox } from "./sandbox";

export function disposeAll(sandbox: Sandbox | null): void {
  // Actors own cloned textures + their own geometry/material, so they must be
  // disposed individually — removing them from the scene isn't enough.
  if (state.player) {
    state.scene?.remove(state.player.sprite.mesh);
    state.player.sprite.dispose();
  }
  state.zombies.forEach((z) => {
    state.scene?.remove(z.sprite.mesh);
    z.sprite.dispose();
  });

  sandbox?.dispose();

  state.pixelPass?.dispose();

  if (state.renderer) {
    // forceContextLoss() releases the GPU context outright. Without it, a few
    // launch/exit cycles will exhaust the browser's WebGL context limit and the
    // game silently stops rendering.
    state.renderer.dispose();
    state.renderer.forceContextLoss();
  }

  state.hudEl?.remove();
  state.container?.remove();
}
