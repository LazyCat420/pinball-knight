/**
 * THE GROOVE — the rut a steel ball engraves into the floor.
 *
 * Not a decal: each stamp is a real floor-fx entry, so it persists, is found by
 * overlap, and is disposed with the floor. These pin the two properties that
 * make it a mechanic rather than a texture — it is laid at an even SPACING
 * regardless of framerate, and it only exists when the ball is heavy enough to
 * cut stone.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { state } from "../state";
import { carveGroove, clearFloorFx } from "./floor-fx";
import { GROOVE_MIN_SPEED, GROOVE_SPACING, GROOVE_LIFE } from "../constants";

beforeEach(() => {
  // spawnFloorFx needs a scene + the floor-fx toggle to do anything.
  state.scene = { add: () => {}, remove: () => {} } as unknown as typeof state.scene;
  state.dbgMaterialFloorFx = true;
  state.zombies = [];
  state.player = null;
  clearFloorFx();
});

const grooves = () => state.floorFx.filter((f) => f.kind === "groove");

describe("carving", () => {
  it("cuts nothing below the minimum speed — a slow roll just polishes stone", () => {
    carveGroove(0, 0, GROOVE_MIN_SPEED - 0.1);
    expect(grooves()).toHaveLength(0);
  });

  it("cuts at and above the minimum speed", () => {
    carveGroove(0, 0, GROOVE_MIN_SPEED + 1);
    expect(grooves()).toHaveLength(1);
    expect(grooves()[0].life).toBeCloseTo(GROOVE_LIFE);
  });

  it("REGRESSION: spaces stamps by distance, not by frame", () => {
    // A per-frame stamp would carpet the floor at high framerates. Ten calls
    // from the same spot must leave ONE cut.
    for (let i = 0; i < 10; i++) carveGroove(0, 0, 14);
    expect(grooves()).toHaveLength(1);

    // Moving less than the spacing still doesn't stamp again…
    carveGroove(GROOVE_SPACING * 0.5, 0, 14);
    expect(grooves()).toHaveLength(1);

    // …but crossing it does.
    carveGroove(GROOVE_SPACING * 1.2, 0, 14);
    expect(grooves()).toHaveLength(2);
  });

  it("lays a continuous furrow along a straight run", () => {
    for (let i = 0; i < 40; i++) carveGroove(i * 0.1, 0, 14);
    const cuts = grooves();
    expect(cuts.length).toBeGreaterThan(3);
    // Consecutive cuts sit at least a spacing apart — a furrow, not a pile.
    for (let i = 1; i < cuts.length; i++) {
      const d = Math.hypot(cuts[i].x - cuts[i - 1].x, cuts[i].z - cuts[i - 1].z);
      expect(d).toBeGreaterThanOrEqual(GROOVE_SPACING - 1e-6);
    }
  });

  it("bites DEEPER at speed — a screaming line scars harder than a cruise", () => {
    carveGroove(0, 0, GROOVE_MIN_SPEED + 0.5);
    const slow = grooves()[0].radius;
    clearFloorFx();
    carveGroove(0, 0, 22);
    const fast = grooves()[0].radius;
    expect(fast).toBeGreaterThan(slow);
  });

  it("starts a fresh floor unscarred — no seam carried across a level change", () => {
    carveGroove(5, 5, 14);
    expect(grooves()).toHaveLength(1);
    clearFloorFx();
    expect(grooves()).toHaveLength(0);
    // The very next cut at the SAME spot must land (the spacing memory reset).
    carveGroove(5, 5, 14);
    expect(grooves()).toHaveLength(1);
  });
});
