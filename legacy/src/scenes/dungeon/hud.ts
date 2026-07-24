/**
 * 🎛️ HUD CONTROLLER — owns the two HUDs and the one shared face between them.
 *
 * The Diablo panel is the iso "strategy layer"; the Wolfenstein bar is the
 * rampage "combat layer". Both are built up-front and parked; setHUDMode slides
 * one out and the other in, and PHYSICALLY MOVES the single face canvas between
 * their two face slots (same DOM node → health/expression never reset on a
 * swap). fps.ts calls setHUDMode('wolf') on rampage entry and ('diablo') on exit.
 */
import { state } from "./state";
import { createDiabloHUD, renderDiablo, refreshDiablo, disposeDiabloHUD } from "./hud-diablo";
import { createWolfHUD, updateWolfHUD, disposeWolfHUD } from "./hud-wolf";
import { disposeFace } from "./hud-face";

/** Build both HUDs (face auto-mounts into the Diablo frame) and set the start mode. */
export function mountHUDs(container: HTMLElement): void {
  createDiabloHUD(container); // this also creates + mounts the shared face
  createWolfHUD(container);
  setHUDMode(state.hudMode);
}

/**
 * Swap the active HUD. Slides the panels and re-parents the shared face into the
 * incoming HUD's face slot. Idempotent — safe to call with the current mode.
 *
 * Elements are resolved by DOM id, NOT by module-level refs: under the dev
 * bundler the hud-* modules can be instantiated more than once across the
 * core/fps/hud import graph, so a module's `panelEl` may be null in the copy
 * that fps.ts calls even though the panel is very much in the DOM. Reaching for
 * the live nodes by id sidesteps that entirely (and is harmless in prod).
 */
export function setHUDMode(mode: "diablo" | "wolf"): void {
  state.hudMode = mode;
  const diablo = document.getElementById("dungeon-hud-diablo");
  const wolf = document.getElementById("dungeon-hud");
  const face = document.getElementById("dungeon-hud-face");
  const wolfSlot = document.getElementById("dungeon-wolf-face-slot");
  const diabloSlot = document.getElementById("dungeon-diablo-face-slot");
  const slide = (el: HTMLElement | null, on: boolean): void => {
    if (el) el.style.transform = on ? "translateY(0)" : "translateY(110%)";
  };
  // The Wolf face-slot is anchored above the (parked) Wolf bar, so its empty
  // frame pokes up over the Diablo face when parked. Only make it visible while
  // the Wolf bar itself is on-screen.
  if (wolfSlot) wolfSlot.style.visibility = mode === "wolf" ? "visible" : "hidden";
  if (mode === "wolf") {
    slide(diablo, false);
    slide(wolf, true);
    if (face && wolfSlot && face.parentElement !== wolfSlot) wolfSlot.appendChild(face);
  } else {
    slide(wolf, false);
    slide(diablo, true);
    if (face && diabloSlot && face.parentElement !== diabloSlot) diabloSlot.appendChild(face);
  }
  state.hudDirty = true;
}

/**
 * Per-frame HUD animation: liquid globes + cooldown rings + the face's own
 * timers (blink/wince). Cheap even when a panel is slid off-screen. Call once
 * per rendered frame with the real elapsed seconds.
 */
export function renderHUD(dt: number): void {
  renderDiablo(dt);
}

/** Rebuild the discrete HUD content (belt tiles, skill icons, bar numbers). */
export function refreshHUD(): void {
  refreshDiablo();
  updateWolfHUD();
}

export function disposeHUDs(): void {
  disposeDiabloHUD();
  disposeWolfHUD();
  disposeFace();
}
