/**
 * THE ` CONSOLE'S TOGGLE — does the key actually reach a screen?
 *
 * This file exists because the console shipped BROKEN TWICE IN A ROW, and both
 * times every other test was green:
 *
 *   1. `createDebugPanel` returned the toggle and core.ts stored it in a
 *      variable called `debugPanelDispose`. Nothing called it, and there was no
 *      Backquote case in the keymap at all — the switch ended with a comment
 *      saying the console owned that key. Documented in three files, reachable
 *      by nothing.
 *   2. The fix for (1) added a guard that refused to stack the console on top
 *      of another screen, written as `some(s => s.id !== "hud")`. A normal play
 *      stack is ["hud", "toasts"] — `toasts` is a second permanent non-pausing
 *      overlay — so the guard matched during ordinary play and the key still
 *      did nothing.
 *
 * The common thread is that both bugs were in the WIRING, not the screen: the
 * debug screen itself painted fine the whole time. So this tests the wiring —
 * given a realistic stack, does toggling produce an open console?
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createDebugPanel, toggleDebugPanel, disposeDebugPanel } from "./debug-panel";
import { push, close, isOpen, screens, type UiScreen } from "./gui/stack";
import type { DebugActions } from "./debug-panel";

/** A no-op action bundle — the toggle never invokes these, it only opens. */
const ACTIONS = new Proxy({} as DebugActions, { get: () => () => {} });

/** A stand-in screen, so the stack looks like it does in play. */
function fakeScreen(id: string, pauses: boolean): UiScreen {
  return { id, pauses, focus: 0, scroll: 0, paint: () => {} };
}

/** Tear the stack down whichever screens are on it. */
function clearStack(): void {
  for (const s of [...screens()]) close(s.id);
}

beforeEach(() => {
  clearStack();
  disposeDebugPanel();
  createDebugPanel(null, ACTIONS);
});

describe("the ` console toggle", () => {
  it("opens from a NORMAL PLAY STACK — hud plus toasts", () => {
    // THE REGRESSION. Both permanent overlays are non-pausing, and neither may
    // block the console. An id-whitelist guard passed every other test in the
    // repo while making the key inert in the only situation it is ever pressed.
    push(fakeScreen("hud", false));
    push(fakeScreen("toasts", false));

    toggleDebugPanel();
    expect(isOpen("debug"), "the console did not open during ordinary play").toBe(true);
  });

  it("opens with nothing else on the stack at all", () => {
    toggleDebugPanel();
    expect(isOpen("debug")).toBe(true);
  });

  it("closes when it is already open", () => {
    push(fakeScreen("hud", false));
    toggleDebugPanel();
    expect(isOpen("debug")).toBe(true);
    toggleDebugPanel();
    expect(isOpen("debug"), "a second press did not close the console").toBe(false);
  });

  it("refuses to stack on top of a PAUSING modal", () => {
    // The guard's real job: ` must not bury the menu or the shop.
    push(fakeScreen("hud", false));
    push(fakeScreen("menu", true));

    toggleDebugPanel();
    expect(isOpen("debug"), "the console opened on top of a modal").toBe(false);
  });

  it("still CLOSES from above a modal, so it can never get stuck open", () => {
    push(fakeScreen("hud", false));
    toggleDebugPanel();
    expect(isOpen("debug")).toBe(true);
    // Something modal arrives over the top of it.
    push(fakeScreen("menu", true));
    toggleDebugPanel();
    expect(isOpen("debug"), "the console could not be closed from under a modal").toBe(false);
  });

  it("is inert before createDebugPanel has run, rather than throwing", () => {
    disposeDebugPanel();
    expect(() => toggleDebugPanel()).not.toThrow();
    expect(isOpen("debug")).toBe(false);
  });
});
