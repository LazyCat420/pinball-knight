/**
 * A TITLE SEQUENCE MUST NOT GET LONGER WHEN THE MACHINE GETS SLOWER.
 *
 * The regression is one line: the phase clock advanced by the SIMULATION's
 * clamped delta, so a 1000ms frame moved the choreography 50ms. Measured live,
 * that turned an 11.4s intro into 22s of /dungeon before the lobby.
 *
 * The clamp itself is not the bug and must survive — remove it and the intro's
 * ball tunnels through the letterforms of its own title on the first long
 * frame. The bug is that ONE number served both.
 */
import { describe, it, expect } from "vitest";
import { introDeltas, SIM_DT_CLAMP } from "./clock";

describe("introDeltas", () => {
  it("advances the phase clock by REAL time, however long the frame was", () => {
    // THE REGRESSION. A one-second frame is a second of the sequence; the old
    // code moved it 50ms and put the other 950ms nowhere.
    expect(introDeltas(1000, 0).pdt).toBeCloseTo(1.0, 6);
    expect(introDeltas(6000, 0).pdt).toBeCloseTo(6.0, 6);
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
