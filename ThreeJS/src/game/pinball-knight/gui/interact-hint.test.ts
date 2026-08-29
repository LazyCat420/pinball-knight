/**
 * The prompt must name the button the player is HOLDING.
 *
 * The defect this came from: the tavern's station prompt said "[E] DESCEND"
 * to a player on a controller, who reasonably concluded the board could not be
 * used with a pad at all and went back to the keyboard.
 */
import { describe, it, expect } from "vitest";
import { interactHint } from "./interact-hint";

describe("interactHint", () => {
  it("names the pad when one is connected", () => {
    expect(interactHint({ pad: true, touch: false })).toBe("[A]");
  });

  it("names the on-screen cross on a touch device", () => {
    expect(interactHint({ pad: false, touch: true })).toBe("[X]");
  });

  it("falls back to the keyboard when neither is there", () => {
    expect(interactHint({ pad: false, touch: false })).toBe("[E]");
  });

  it("prefers the pad over the on-screen one — a tablet with a pad plugged in", () => {
    // Both are real inputs on that device. The pad wins because plugging one in
    // is a deliberate act and the hands are already on it.
    expect(interactHint({ pad: true, touch: true })).toBe("[A]");
  });

  it("stays inside the pixel font's atlas", () => {
    // The label is drawn by `text()` at size 8. A glyph the atlas lacks draws
    // NOTHING, with no error — so the PlayStation cross the on-screen pad
    // paints as a SHAPE cannot be typed here, and any future hint must stay
    // ASCII too.
    for (const d of [
      { pad: true, touch: false },
      { pad: false, touch: true },
      { pad: false, touch: false },
    ]) {
      expect(interactHint(d)).toMatch(/^\[[ -~]+\]$/);
    }
  });
});
