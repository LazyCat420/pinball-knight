import { describe, it, expect } from "vitest";
import { analyzePatternGrammar, isLegalSlotForPart, classifyWallSlot } from "./pattern-grammar";
import { buildTrackFloor } from "./track-floor";
import { archetypeFor } from "./archetypes";
import { mulberry32 } from "../../../utils/rng";

describe("pattern-grammar — Architectural Wall & Floor Slots", () => {
  it("enforces that corner parts CANNOT be placed in straight corridor slots", () => {
    expect(isLegalSlotForPart("deflector", "straight_3wide")).toBe(false);
    expect(isLegalSlotForPart("boostcorner", "straight_3wide")).toBe(false);
    expect(isLegalSlotForPart("deflector", "corner_inner")).toBe(true);
    expect(isLegalSlotForPart("boostcorner", "corner_inner")).toBe(true);
  });

  it("enforces that threshold clearways reject all obstructive furniture", () => {
    expect(isLegalSlotForPart("booster", "threshold_clearway")).toBe(false);
    expect(isLegalSlotForPart("deflector", "threshold_clearway")).toBe(false);
    expect(isLegalSlotForPart("bumper", "threshold_clearway")).toBe(false);
  });

  it("correctly analyzes pattern slots on a generated track floor", () => {
    const rng = mulberry32(12345);
    const arch = archetypeFor(1);
    const track = buildTrackFloor(21, 21, rng, { profile: arch.track });
    expect(track).not.toBeNull();
    if (!track) return;

    const grammar = analyzePatternGrammar(track.grid, track.doorways, track.chambers);
    expect(grammar.w).toBe(track.grid.w);
    expect(grammar.h).toBe(track.grid.h);

    let straightCount = 0;
    let cornerCount = 0;
    let clearwayCount = 0;

    for (let j = 0; j < grammar.h; j++) {
      for (let i = 0; i < grammar.w; i++) {
        const slot = grammar.getSlot(i, j);
        if (slot.slotType === "straight_3wide") straightCount++;
        if (slot.slotType === "corner_inner") cornerCount++;
        if (slot.slotType === "threshold_clearway") clearwayCount++;
      }
    }

    expect(straightCount).toBeGreaterThan(0);
    expect(cornerCount).toBeGreaterThan(0);
    if (track.doorways.length > 0) {
      expect(clearwayCount).toBeGreaterThan(0);
    }
  });
});
