/**
 * THE PAUSE CONTRACT.
 *
 * `core.isSimPaused()` is the single most consequential boolean in the game —
 * `simulate()` early-returns on it and the run clock stops booking time. Under
 * the DOM overlays it was derived from whether four elements happened to be
 * non-null, so "is the game paused" was a question about the document tree. A
 * screen that forgot to null its element left the world frozen; one that nulled
 * it early let monsters move under an open menu.
 *
 * Here it is a property of the stack, and these tests pin it.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { state } from "../state";
import { push, pop, close, clearScreens, screens, top, isOpen, type UiScreen } from "./stack";

function screen(id: string, pauses = true): UiScreen {
  return { id, pauses, focus: 0, scroll: 0, paint: () => {} };
}

describe("screen stack", () => {
  beforeEach(() => clearScreens());

  it("pauses the sim while any pausing screen is open", () => {
    expect(state.uiPauses).toBe(false);
    push(screen("menu"));
    expect(state.uiPauses).toBe(true);
    pop();
    expect(state.uiPauses).toBe(false);
  });

  it("does NOT pause for a non-pausing screen", () => {
    // The HUD and toasts are screens too, and they must never freeze the game.
    push(screen("hud", false));
    expect(state.uiPauses).toBe(false);
  });

  it("stays paused while a pausing screen remains underneath", () => {
    push(screen("tavern"));
    push(screen("vendor"));
    pop();
    expect(state.uiPauses).toBe(true);
    pop();
    expect(state.uiPauses).toBe(false);
  });

  it("keeps the pause flag correct when a non-pausing screen sits on top", () => {
    push(screen("menu", true));
    push(screen("toast", false));
    expect(state.uiPauses).toBe(true);
  });

  it("gives input to the top screen only", () => {
    push(screen("tavern"));
    push(screen("vendor"));
    expect(top()?.id).toBe("vendor");
    expect(screens().map((s) => s.id)).toEqual(["tavern", "vendor"]);
  });

  it("refuses to stack a duplicate of what is already on top", () => {
    // Every DOM opener carried its own `if (state.menuEl) return` guard. One
    // rule in one place replaces six copies of it.
    push(screen("menu"));
    push(screen("menu"));
    expect(screens()).toHaveLength(1);
  });

  it("runs onClose when popped, closed or cleared", () => {
    const onClose = vi.fn();
    push({ ...screen("a"), onClose });
    pop();
    expect(onClose).toHaveBeenCalledTimes(1);

    const onClose2 = vi.fn();
    push({ ...screen("b"), onClose: onClose2 });
    push(screen("c"));
    close("b"); // closes b AND everything above it
    expect(onClose2).toHaveBeenCalledTimes(1);
    expect(screens()).toHaveLength(0);

    const onClose3 = vi.fn();
    push({ ...screen("d"), onClose: onClose3 });
    clearScreens();
    expect(onClose3).toHaveBeenCalledTimes(1);
  });

  it("close() on an id that is not open is a no-op", () => {
    push(screen("menu"));
    close("nothing-like-this");
    expect(screens()).toHaveLength(1);
    expect(isOpen("menu")).toBe(true);
  });

  it("leaves the sim unpaused after clearScreens, whatever was open", () => {
    // The teardown path. A stale `uiPauses` after a run ends would freeze the
    // NEXT run before it started — the failure mode that is hardest to trace
    // back to a menu, because by then no menu exists.
    push(screen("menu"));
    push(screen("vendor"));
    clearScreens();
    expect(state.uiPauses).toBe(false);
    expect(top()).toBeNull();
  });
});
