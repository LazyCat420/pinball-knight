/**
 * A PANEL THAT PAUSES THE WORLD MUST STILL BE DRAWN.
 *
 * The walkable tavern's panels — the four vendor counters, the run summary, the
 * menu, the casino cabinet — are painted screens inside the scene's own pixel
 * pass, and `drawUiFrame` is wired into that pass's `render`/`presentUi`. So the
 * frame loop's "skip the 3D pass while a panel is up" optimisation, written as a
 * bare `return`, skipped the panel too: its paint AND its input, every frame,
 * for as long as it was open. Walking up to the Alchemist and pressing E froze
 * the game on the last frame of the room with no way out.
 *
 * The regression is one mapping: `frozen` must never present nothing. This is
 * the assertion the bug could not survive, and it is cheap because `presentMode`
 * is a pure function in its own module — `core.ts` needs a WebGPU renderer to
 * import at all.
 */
import { describe, it, expect } from "vitest";
import { presentMode } from "./present";

describe("presentMode", () => {
  it("presents the UI — never nothing — while a panel is open", () => {
    // THE REGRESSION. Any future edit that skips work while frozen has to keep
    // this true, and "ui-only" is the only answer that does: it drops the scene
    // and the bloom chain (the whole point of the skip) while still driving
    // `drawUiFrame`, which is what paints the panel and what reads Esc.
    expect(presentMode(true, true)).toBe("ui-only");
    expect(presentMode(true, true)).not.toBe("none");
  });

  it("renders the room when nothing is open", () => {
    expect(presentMode(true, false)).toBe("scene");
  });

  it("presents nothing until the renderer backend has initialised", () => {
    // The async backend init has to land before any render/present call, which
    // throws otherwise. This is the ONE case where dropping the frame is right,
    // and it cannot hide the bug above: a panel cannot be open this early.
    expect(presentMode(false, false)).toBe("none");
    expect(presentMode(false, true)).toBe("none");
  });
});
