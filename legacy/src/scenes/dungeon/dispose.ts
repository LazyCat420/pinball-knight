/**
 * Teardown. Every game here is expected to leave nothing behind — geometry,
 * materials, textures, render targets, the WebGL context and the overlay div.
 */
import { state } from "./state";
import { clearProjectiles, disposeProjectileAssets } from "./entities/projectiles";
import { disposeNpcs } from "./entities/npc";
import { disposePinballParts } from "./render/pinball-parts";
import { disposeHUDs } from "./hud";

/**
 * Tear down one depth: the maze geometry, the horde (including corpses), any
 * loot still on the floor and anything mid-flight. The player actor survives
 * level changes — only its position resets.
 */
export function disposeLevel(): void {
  state.zombies.forEach((z) => {
    state.scene?.remove(z.sprite.mesh);
    z.sprite.dispose();
  });
  state.zombies = [];

  clearProjectiles();

  state.groundItems.forEach((it) => {
    state.scene?.remove(it.sprite.mesh);
    it.sprite.dispose();
  });
  state.groundItems = [];

  state.props.forEach((p) => {
    state.scene?.remove(p.sprite.mesh);
    p.sprite.dispose();
  });
  state.props = [];

  disposePinballParts(state.scene);
  disposeNpcs();

  // Multi-Ball ghost knights: their materials are clones, their geometry and
  // atlas belong to the player — dispose only what's ours.
  if (state.multiMeshes) {
    for (const mesh of state.multiMeshes) {
      state.scene?.remove(mesh);
      (mesh.material as { dispose(): void }).dispose();
    }
    state.multiMeshes = null;
  }

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

  // The shared atlases the per-actor textures were cloned from — one knight
  // sheet per weapon the run has held, plus every zombie variant sheet.
  state.playerSheets.forEach((sheet) => sheet.texture.dispose());
  state.playerSheets.clear();
  state.zombieVariantSheets.forEach((sheet) => sheet.texture.dispose());
  state.zombieVariantSheets = [];
  state.zombieSheet = null;
  state.spiderSheet?.texture.dispose();
  state.spiderSheet = null;
  state.bruteSheet?.texture.dispose();
  state.bruteSheet = null;
  state.spitterSheet?.texture.dispose();
  state.spitterSheet = null;
  state.ghostSheet?.texture.dispose();
  state.ghostSheet = null;
  state.batSheet?.texture.dispose();
  state.batSheet = null;
  state.slimeSheet?.texture.dispose();
  state.slimeSheet = null;
  state.bossSheet?.texture.dispose();
  state.bossSheet = null;
  for (const s of [state.goblinSheet, state.pinSheet, state.golemSheet, state.chomperSheet, state.magnetSheet, state.webspinnerSheet]) s?.texture.dispose();
  state.goblinSheet = state.pinSheet = state.golemSheet = state.chomperSheet = state.magnetSheet = state.webspinnerSheet = null;

  disposeProjectileAssets();

  state.vfx?.dispose();
  state.vfx = null;

  state.pixelPass?.dispose();

  if (state.renderer) {
    // forceContextLoss() releases the GPU context outright. Without it, a few
    // launch/exit cycles will exhaust the browser's WebGL context limit and the
    // game silently stops rendering.
    state.renderer.dispose();
    state.renderer.forceContextLoss();
  }

  state.gameOverEl?.remove();
  state.shopEl?.remove();
  disposeHUDs(); // removes the Diablo + Wolf panels and the shared face
  state.hudEl = null;
  state.fpsOverlayEl?.remove();
  state.comboFlashEl?.remove();
  state.bossBarEl?.remove();
  state.container?.remove();
  // The FPS perspective camera holds no GPU resources of its own — just drop it.
  state.fpsCamera = null;
}
