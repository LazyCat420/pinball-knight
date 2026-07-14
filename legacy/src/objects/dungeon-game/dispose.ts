/**
 * Teardown. Every game here is expected to leave nothing behind — geometry,
 * materials, textures, render targets, the WebGL context and the overlay div.
 */
import { state } from "./state";

/**
 * Tear down one depth: the maze geometry, the horde (including corpses) and
 * any loot still on the floor. The player actor survives level changes — only
 * its position resets.
 */
export function disposeLevel(): void {
  state.zombies.forEach((z) => {
    state.scene?.remove(z.sprite.mesh);
    z.sprite.dispose();
  });
  state.zombies = [];

  state.groundItems.forEach((it) => {
    state.scene?.remove(it.sprite.mesh);
    it.sprite.dispose();
  });
  state.groundItems = [];

  state.maze?.dispose();
  state.maze = null;
  state.grid = null;
  state.stairs = null;
  state.flowField = null;
}

export function disposeAll(): void {
  disposeLevel();

  // Actors own cloned textures + their own geometry/material, so they must be
  // disposed individually — removing them from the scene isn't enough.
  if (state.player) {
    state.player.silhouette?.dispose();
    state.scene?.remove(state.player.sprite.mesh);
    state.player.sprite.dispose();
  }

  // The shared atlases the per-actor textures were cloned from.
  state.playerSheet?.texture.dispose();
  state.zombieSheet?.texture.dispose();

  state.pixelPass?.dispose();

  if (state.renderer) {
    // forceContextLoss() releases the GPU context outright. Without it, a few
    // launch/exit cycles will exhaust the browser's WebGL context limit and the
    // game silently stops rendering.
    state.renderer.dispose();
    state.renderer.forceContextLoss();
  }

  state.gameOverEl?.remove();
  state.hudEl?.remove();
  state.container?.remove();
}
