/**
 * THE RIBBON'S LIFE KNOB MUST ACTUALLY BE THE KNOB.
 *
 * `TrailRibbon` is a ring buffer fed one point per physics substep. If capacity
 * is smaller than `rate × life`, points die by being OVERWRITTEN before the age
 * check ever looks at them: the tail stops at a length nobody chose, and the
 * constant that appears to control it does nothing.
 *
 * That has now happened once and been narrowly avoided once:
 *
 *   · capacity 64 vs a 0.45s life — the buffer wrapped in 0.36s, so TRAIL_LIFE
 *     was decorative (fixed by raising capacity to 96, and documented there);
 *   · capacity 96 vs the laser's 1.9s ghost lattice, which needs 342 — raising
 *     the life alone would have silently reproduced the first bug, in a form
 *     that is HARDER to see because a 96-point tail at laser speed still looks
 *     like a beam. It is just a beam that mysteriously never gets longer.
 *
 * So the relationship is asserted rather than commented. This is deliberately a
 * test of ARITHMETIC, not of rendering: it needs no canvas, and the failure it
 * catches is invisible in a screenshot precisely because the effect still works.
 */
import { describe, expect, it } from "vitest";
import { TRAIL_CAPACITY, TRAIL_PUSH_RATE } from "../fx/system";
import { RICOCHET_FLAVORS } from "../entities/ricochet-form";
import { BOLT_DURATION, LASER_DURATION } from "../constants";

/** Every flavour's tail life, from the table the game actually reads. */
const LIVES = Object.values(RICOCHET_FLAVORS).map((f) => f.trailLife);

describe("the trail ring buffer", () => {
  it("holds every flavour's full tail without overwriting it", () => {
    for (const [kind, f] of Object.entries(RICOCHET_FLAVORS)) {
      const needed = Math.ceil(TRAIL_PUSH_RATE * f.trailLife);
      expect(
        TRAIL_CAPACITY,
        `${kind} asks for a ${f.trailLife}s tail = ${needed} points at ${TRAIL_PUSH_RATE}/s, ` +
          `but the buffer holds ${TRAIL_CAPACITY} — the tail would be capacity-bound, not life-bound`,
      ).toBeGreaterThanOrEqual(needed);
    }
  });

  it("holds a whole cast, so the oldest leg is still lit when the form ends", () => {
    // The point of the laser's lattice: the beams laid at the start of the cast
    // must still be on screen at the end of it.
    for (const [kind, dur] of [
      ["laser", LASER_DURATION],
      ["bolt", BOLT_DURATION],
    ] as const) {
      const held = Math.min(RICOCHET_FLAVORS[kind].trailLife, dur);
      expect(TRAIL_CAPACITY).toBeGreaterThanOrEqual(Math.ceil(TRAIL_PUSH_RATE * held));
    }
  });

  it("is not wastefully larger than the longest tail asked for", () => {
    // The other direction. 448 floats × 3 axes × 3 strands × 2 attributes is
    // cheap, but a buffer ten times the need is a signal that a life was cut
    // and nobody came back — and it is walked in full every frame.
    const longest = Math.ceil(TRAIL_PUSH_RATE * Math.max(...LIVES));
    expect(TRAIL_CAPACITY).toBeLessThanOrEqual(longest * 2);
  });
});
