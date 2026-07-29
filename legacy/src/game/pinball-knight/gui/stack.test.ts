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
import { MAX_UI_ZOOM, screenZoom } from "./root";
import { state } from "../state";
import { push, pop, close, remove, clearScreens, screens, top, isOpen, type UiScreen } from "./stack";

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

  it("remove() takes ONE screen out and leaves what was above it", () => {
    // The distinction that cost a silent bug: `close` truncates (right for a
    // modal and its children), `remove` excises (right for the bottom-of-stack
    // layers). The tavern raised its station prompt and then closed the HUD —
    // `close` found the HUD at index 0 and took the prompt with it, so the
    // scene rendered perfectly with no interface at all.
    push(screen("hud", false));
    push(screen("toasts", false));
    push(screen("station-prompt", false));
    remove("hud");
    expect(screens().map((s) => s.id)).toEqual(["toasts", "station-prompt"]);
    // ...whereas close() on the same stack takes everything above it.
    close("toasts");
    expect(screens()).toHaveLength(0);
  });

  it("close() on an id that is not open is a no-op", () => {
    push(screen("menu"));
    close("nothing-like-this");
    expect(screens()).toHaveLength(1);
    expect(isOpen("menu")).toBe(true);
  });

  it("does NOT pause — and so does not capture input — for the HUD", () => {
    // The regression this pins: the HUD is a screen and is open for the whole
    // run. Gating keyboard CAPTURE on "any screen is open" made the UI swallow
    // WASD and Space the moment the HUD existed — a game that renders perfectly
    // and cannot be played. Capture follows this flag, so this flag is the test.
    push(screen("hud", false));
    push(screen("toasts", false));
    push(screen("floor-map", false));
    expect(state.uiPauses).toBe(false);
    // ...and a real sheet on top of all three does pause.
    push(screen("menu", true));
    expect(state.uiPauses).toBe(true);
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

/**
 * THE DESIGN ZOOM — see `UiScreen.design` and `screenZoom`.
 *
 * The rule that matters is WHOLE NUMBERS. A fractional magnification of a
 * nearest-sampled layer makes every UI pixel alternately 1 or 2 texels wide,
 * which is the same "game-wide mush" the renderer's own integer-scale note in
 * pixel-pass.ts exists to prevent — and it would arrive silently, as "the menu
 * looks a bit off" rather than as a bug in anything.
 */
describe("screenZoom", () => {
  it("is 1 for a screen that declares nothing, which is the old behaviour", () => {
    expect(screenZoom(undefined, 1600, 900)).toBe(1);
  });

  it("takes the largest WHOLE zoom at which the design box still fits", () => {
    expect(screenZoom({ w: 800, h: 450 }, 1600, 900)).toBe(2);
    expect(screenZoom({ w: 480, h: 270 }, 1600, 900)).toBe(3);
    // 940x640 does not fit twice into 1600x900 — a sheet that dense stays 1x
    // rather than being clipped.
    expect(screenZoom({ w: 940, h: 640 }, 1600, 900)).toBe(1);
  });

  it("is bounded by the TIGHTER axis, so nothing is ever clipped", () => {
    // Twice as wide as it needs, but only just tall enough: still 1x.
    expect(screenZoom({ w: 400, h: 700 }, 1600, 900)).toBe(1);
  });

  it("never drops below 1, even on a grid smaller than the design box", () => {
    // Clipping is visible and fixable; a fractional shrink is neither.
    expect(screenZoom({ w: 800, h: 450 }, 640, 360)).toBe(1);
  });

  it("is capped, so a tiny design box on a huge grid is not six giant words", () => {
    expect(screenZoom({ w: 100, h: 60 }, 3840, 2160)).toBe(MAX_UI_ZOOM);
  });
});
