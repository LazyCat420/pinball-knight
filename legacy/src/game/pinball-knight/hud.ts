/**
 * 🎛️ HUD CONTROLLER — now a thin shim over one in-game screen.
 *
 * WHAT THIS USED TO BE. Two DOM panels (`hud-diablo.ts`, the iso strategy layer,
 * and `hud-wolf.ts`, the rampage combat bar) were both built up-front and
 * parked off-screen; `setHUDMode` slid one in and the other out, and PHYSICALLY
 * MOVED the single shared face canvas between their two face slots so that
 * health and expression would not reset on a swap. It also had to resolve
 * elements by DOM id rather than by module reference, because under the dev
 * bundler the hud-* modules could be instantiated more than once across the
 * core/fps/hud import graph.
 *
 * ALL OF THAT IS GONE, and none of it was essential complexity — it was the
 * cost of expressing "which layout is on screen" as the position of parked DOM
 * nodes. `gui/screens/hud.ts` paints whichever layout `state.hudMode` names, so
 * a mode change is a variable assignment, the face never moves because nothing
 * owns it, and there is no id to resolve.
 *
 * The module survives only because `core.ts`, `fps.ts` and `dispose.ts` call
 * these four functions, and `core.ts` is at its decomposition ratchet.
 */
import { state } from "./state";
import { disposeFace } from "./hud-face";
import { hudScreen } from "./gui/screens/hud";
import { toastScreen } from "./gui/screens/toasts";
import { isOpen as uiIsOpen, push as pushUiScreen, remove as removeUiScreen } from "./gui/stack";

/**
 * Raise the HUD and the transient text layer. Idempotent — the stack refuses a
 * duplicate id.
 *
 * TWO screens, in this order, and the order is the design: toasts must paint
 * ABOVE the HUD panel or a pickup note slides under the belt tiles. Neither
 * pauses, so neither takes input.
 */
export function mountHUDs(_container?: HTMLElement): void {
  if (!uiIsOpen("hud")) pushUiScreen(hudScreen());
  if (!uiIsOpen("toasts")) pushUiScreen(toastScreen());
}

/**
 * Swap the active layout. There is nothing to slide and no face to re-parent —
 * the HUD screen reads `state.hudMode` while it paints, so this IS the swap.
 */
export function setHUDMode(mode: "diablo" | "wolf"): void {
  state.hudMode = mode;
  state.hudDirty = true;
}

/** Kept for the call site in core's loop. Immediate mode paints every frame. */
export function renderHUD(_dt: number): void {}

/** Kept for the call site in core's loop. There is no retained state to refresh. */
export function refreshHUD(): void {}

export function disposeHUDs(): void {
  removeUiScreen("toasts");
  removeUiScreen("hud");
  disposeFace();
}
