/**
 * Teardown. Every game here is expected to leave nothing behind — geometry,
 * materials, textures, render targets, the WebGL context and the overlay div.
 */
import { state } from "./state";
import { clearProjectiles, disposeProjectileAssets } from "./entities/projectiles";
import { clearFloorFx, disposeFloorFxAssets } from "./entities/floor-fx";
import { disposeNpcs } from "./entities/npc";
import { disposeMultiBall } from "./entities/multiball";
import { disposePinballParts } from "./render/pinball-parts";
import { disposeLampPuzzle } from "./lamp-puzzle";
import { disposeHUDs } from "./hud";
import { clearScreens } from "./gui/stack";
import { disposeUiLayer } from "./gui/layer";
import { resetAmbience } from "./sfx/ambience";

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
  clearFloorFx();

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
  disposeLampPuzzle(state.scene);
  disposeNpcs();
  // The echo knights hold their own cloned textures + geometry; the buff timer
  // survives the descent, so updateMultiBall re-spawns them on the next floor.
  disposeMultiBall();

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
  // The bespoke sheets that arrived AFTER this block was written were never
  // added to it — six atlases (~4131x81 canvas textures each) leaked per
  // launch/exit cycle, found 2026-07-30 while adding the baked tints below.
  for (const s of [state.sporelingSheet, state.jesterSheet, state.croakerSheet, state.rotortailSheet, state.stiltneckSheet, state.houndSheet]) s?.texture.dispose();
  state.sporelingSheet = state.jesterSheet = state.croakerSheet = state.rotortailSheet = state.stiltneckSheet = state.houndSheet = null;
  // The baked TINTED expansion atlases (spawn/factory.ts makeExpansion) — each
  // owns its own CanvasTexture over its own canvas, distinct from the base
  // sheet it was dyed from, so each is its own leak if skipped here.
  for (const s of Object.values(state.expansionSheets)) s?.texture.dispose();
  state.expansionSheets = {};

  disposeProjectileAssets();
  disposeFloorFxAssets();

  state.vfx?.dispose();
  state.vfx = null;
  state.aimIndicator?.dispose();
  state.aimIndicator = null;

  state.pixelPass?.dispose();

  if (state.renderer) {
    // forceContextLoss() releases the GPU context outright. Without it, a few
    // launch/exit cycles will exhaust the browser's WebGL context limit and the
    // game silently stops rendering.
    //
    // That method exists ONLY on the legacy WebGLRenderer. WebGPURenderer does
    // the same job inside dispose(): WebGLBackend.dispose() fetches the
    // WEBGL_lose_context extension and calls loseContext() itself (see
    // renderers/webgl-fallback/WebGLBackend.js), and the WebGPU backend
    // releases the device there too. So dispose() alone is now the whole
    // teardown — an optional-chained forceContextLoss?.() would be dead code
    // that silently stopped protecting against context exhaustion.
    state.renderer.dispose();
  }

  // The sustained beds. They would fade themselves out within HOLD seconds
  // anyway — that is the point of the dead-man's switch in `sfx/ambience.ts` —
  // but a full teardown should not leave a looping source node alive against a
  // context the next launch will replace.
  resetAmbience();

  // Every overlay this used to remove one node at a time is now a screen.
  clearScreens();
  disposeHUDs();
  disposeUiLayer();
  state.container?.remove();
  // The FPS perspective camera holds no GPU resources of its own — just drop it.
  state.fpsCamera = null;
}
