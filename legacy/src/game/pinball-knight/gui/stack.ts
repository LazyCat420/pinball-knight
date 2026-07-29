/**
 * THE SCREEN STACK — modality as game state instead of as DOM presence.
 *
 * `core.isSimPaused()` used to ask "is any of `shopEl / tavernEl /
 * cardReaderEl / menuEl` a live DOM node?". That worked, but it meant the
 * PAUSE CONTRACT — the single most important piece of state in the game, the
 * thing `simulate()` early-returns on — was stored in the document tree. A
 * screen that forgot to null its element left the game paused forever; one that
 * nulled it early unpaused the world underneath an open menu.
 *
 * Here a screen is a value on a stack. It pauses because it says it does.
 *
 * ## Why a stack and not a single `current`
 *
 * The tavern opens the vendor counter over itself; the menu can raise a confirm
 * over its own sheet; the haul screen hands off to the tavern. The DOM version
 * expressed this by layering `z-index`es and hoping the keyboard cascade in
 * `input/keymap.ts` matched — that cascade's comment already warns that the
 * ORDER of its checks is the design and reordering them is a behaviour change.
 * A stack makes that order explicit: input goes to the top, everything paints
 * bottom-up, and "most modal first" is a fact about the data rather than a
 * convention to be preserved by hand.
 */
import { state } from "../state";
import { setUiInputLive } from "./input";
import type { UiFrame } from "./im";

export interface UiScreen {
  /** Stable id — for debugging, `__gui.stack()`, and duplicate suppression. */
  id: string;
  /**
   * Freeze the simulation while this is open. HUDs and toasts are false; every
   * full-screen sheet is true.
   */
  pauses: boolean;
  /** Focus cursor, persisted across frames. Owned by the screen, not the frame. */
  focus: number;
  /** Scroll offset for the screen's main region, if it has one. */
  scroll: number;
  /** Paint one frame and handle its own input. */
  paint(f: UiFrame, self: UiScreen): void;
  /** Called when the screen is popped, for any teardown it owns. */
  onClose?(): void;
  /**
   * Handle `cancel` (Esc / B). Return true if handled; otherwise the screen is
   * popped. Screens with an armed confirm use this to disarm first.
   */
  onCancel?(self: UiScreen): boolean;
}

const stack: UiScreen[] = [];

/** Everything currently open, bottom-up. Painting order. */
export function screens(): readonly UiScreen[] {
  return stack;
}

/** The screen that owns input right now. */
export function top(): UiScreen | null {
  return stack.length ? stack[stack.length - 1] : null;
}

export function isOpen(id: string): boolean {
  return stack.some((s) => s.id === id);
}

/**
 * Recompute the pause flag `core.isSimPaused()` reads.
 *
 * Mirrored onto `state` rather than exported as a function so that core.ts can
 * consult it without a new import — the file is at its decomposition ratchet
 * (`core-boundary.test.ts`) and every other modal in that same expression is
 * already a `state` field, so this is the shape that file already expects. When
 * the DOM overlays are gone the whole expression collapses to this flag.
 */
/**
 * Whether the UI should own the keyboard right now.
 *
 * NOT "is any screen open". The HUD, the toasts and the floor map are all
 * screens and all stay open during play — gating capture on mere openness meant
 * the UI swallowed WASD, Space and every gameplay key the moment the HUD
 * existed, which is a game that renders perfectly and cannot be played.
 *
 * A screen wants the keyboard exactly when it pauses the world. That is the
 * same condition, and keeping it as one expression is what stops the two from
 * drifting apart.
 */
function syncPause(): void {
  state.uiPauses = stack.some((s) => s.pauses);
  // Arm the listeners THE INSTANT a pausing screen opens, not on the next
  // painted frame. Deferring it to the driver means every key pressed between
  // "the screen opened" and "the loop got round to rendering" is dropped — and
  // while a human cannot usually type that fast, a gamepad tap or anything that
  // opens a screen programmatically absolutely can. It presented as a flaky
  // off-by-one in the focus cursor.
  setUiInputLive(state.uiPauses);
}

export function push(s: UiScreen): void {
  // Re-opening what is already on top is a no-op, not a second copy. The DOM
  // version guarded this with `if (state.menuEl) return` in every opener; here
  // it is one rule in one place.
  if (top()?.id === s.id) return;
  stack.push(s);
  syncPause();
}

export function pop(): UiScreen | null {
  const s = stack.pop() ?? null;
  s?.onClose?.();
  syncPause();
  return s;
}

/** Pop until `id` is gone. Safe if it was never there. */
export function close(id: string): void {
  const i = stack.findIndex((s) => s.id === id);
  if (i < 0) return;
  for (let n = stack.length - 1; n >= i; n--) stack[n].onClose?.();
  stack.length = i;
  syncPause();
}

/** Drop everything — run teardown, level change, dispose. */
export function clearScreens(): void {
  for (let n = stack.length - 1; n >= 0; n--) stack[n].onClose?.();
  stack.length = 0;
  syncPause();
}
