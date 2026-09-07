import { describe, it, expect } from "vitest";
import { introDeltas, SIM_DT_CLAMP, PRESENTATION_DT_CLAMP } from "./clock";

describe("introDeltas", () => {
  it("preserves unseen animation after a stall instead of skipping a chapter", () => {
    expect(introDeltas(1000, 0).pdt).toBe(PRESENTATION_DT_CLAMP);
    expect(introDeltas(6000, 0).pdt).toBe(PRESENTATION_DT_CLAMP);
    // A 6-second stall at arcade entry cannot jump past the machine shot.
    expect(9 + introDeltas(6000, 0).pdt).toBeLessThan(12);
  });

  it("keeps normal 20fps choreography on time without the physics clamp", () => {
    expect(introDeltas(50, 0).pdt).toBeCloseTo(0.05);
    expect(introDeltas(80, 0).pdt).toBeCloseTo(0.08);
  });

  it("still clamps the simulation step, however long the frame was", () => {
    // THE THING THE CLAMP WAS ALWAYS FOR. The ball moves per step; an unclamped
    // step on a stalled frame carries it through a wall.
    expect(introDeltas(1000, 0).dt).toBe(SIM_DT_CLAMP);
    expect(introDeltas(6000, 0).dt).toBe(SIM_DT_CLAMP);
  });

  it("keeps the two equal on a normal frame", () => {
    // At 60fps nothing about the sequence changes, which is what makes this
    // safe: the split only bites on frames that were already dropping work.
    const d = introDeltas(16.7, 0);
    expect(d.pdt).toBeCloseTo(0.0167, 4);
    expect(d.dt).toBeCloseTo(d.pdt, 6);
  });

  it("steps nothing on the first frame", () => {
    // `lastNow` is stamped by the first TICK, not at construction — buildMaze
    // and compileAsync run synchronously in between, and an honest phase clock
    // would spend that on the sequence before a single frame had been drawn.
    expect(introDeltas(9999, -1)).toEqual({ pdt: 0, dt: 0 });
  });

  it("never steps backwards", () => {
    // performance.now() is monotonic, but a clock that went backwards would
    // rewind the phase and re-fire its edge triggers.
    expect(introDeltas(100, 200).pdt).toBe(0);
    expect(introDeltas(100, 200).dt).toBe(0);
  });
});
