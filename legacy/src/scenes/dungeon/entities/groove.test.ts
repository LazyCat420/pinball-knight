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
import { carveGroove, clearFloorFx, updateFloorFx, updateGrooveHop } from "./floor-fx";
import {
  GROOVE_MIN_SPEED,
  GROOVE_SPACING,
  GROOVE_LIFE,
  GROOVE_HOP_MIN_SPEED,
  GROOVE_HOP_SPEED_KEEP,
  GROOVE_RAIL_MAX_SPEED,
} from "../constants";

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


// ── The rut has a SHAPE — the ball reacts to it ──────────────────────────────
//
// The first cut only ever pulled toward a groove's centre, which made it a
// trail you follow rather than a feature you feel. A real cut is DIRECTIONAL:
// crossing it broadside launches you off the lip, clipping it deflects you,
// riding it rails you.

/** A ball sitting on a groove, travelling along `dir`. */
function ballOn(fx: { x: number; z: number }, dirX: number, dirZ: number, speed: number) {
  state.player = {
    x: fx.x,
    z: fx.z,
    momX: dirX,
    momZ: dirZ,
    momSpeed: speed,
    grooveHopT: 0,
    grooveHopDur: 0,
    grooveHopCdT: 0,
    sprite: { mesh: { position: { y: 0 } }, setElevation: () => {} },
  } as unknown as typeof state.player;
  return state.player!;
}

describe("the groove is directional", () => {
  it("stores the heading the ball cut it with", () => {
    carveGroove(0, 0, 14, 1, 0);
    const cut = grooves()[0];
    expect(cut.dirX).toBeCloseTo(1);
    expect(cut.dirZ).toBeCloseTo(0);
  });

  it("normalises a non-unit heading", () => {
    carveGroove(0, 0, 14, 3, 4); // length 5
    const cut = grooves()[0];
    expect(Math.hypot(cut.dirX!, cut.dirZ!)).toBeCloseTo(1);
  });

  it("CROSSING it broadside launches the ball and costs a little speed", () => {
    carveGroove(0, 0, 14, 1, 0); // cut runs along +X
    const p = ballOn({ x: 0, z: 0 }, 0, 1, 14); // travelling across it, +Z
    updateFloorFx(0.016);
    expect(p.grooveHopT).toBeGreaterThan(0); // airborne
    expect(p.momSpeed).toBeCloseTo(14 * GROOVE_HOP_SPEED_KEEP);
    // A lip launches you ONWARD — it must not turn you.
    expect(p.momX).toBeCloseTo(0);
    expect(p.momZ).toBeCloseTo(1);
  });

  it("does NOT launch a ball that is crawling", () => {
    carveGroove(0, 0, 14, 1, 0);
    const p = ballOn({ x: 0, z: 0 }, 0, 1, GROOVE_HOP_MIN_SPEED - 1);
    updateFloorFx(0.016);
    expect(p.grooveHopT).toBe(0);
  });

  it("RIDING it rails the ball toward the cut's centre-line", () => {
    carveGroove(0, 0, 14, 1, 0);
    // Travelling along the cut but offset to one side.
    const p = ballOn({ x: 0, z: 0.2 }, 1, 0, GROOVE_RAIL_MAX_SPEED - 2);
    updateFloorFx(0.05);
    expect(p.grooveHopT).toBe(0); // riding, not launched
    expect(p.momZ).toBeLessThan(0); // pulled back toward z=0
  });

  it("a SCREAMING ball rides straight over its own rut", () => {
    carveGroove(0, 0, 14, 1, 0);
    const p = ballOn({ x: 0, z: 0.2 }, 1, 0, GROOVE_RAIL_MAX_SPEED + 5);
    updateFloorFx(0.05);
    expect(p.momZ).toBeCloseTo(0); // untouched
  });

  it("GLANCING it swoops the heading toward the cut's line", () => {
    carveGroove(0, 0, 14, 1, 0); // cut along +X
    // ~55° across: past the cross threshold, short of the ride one.
    const a = (55 * Math.PI) / 180;
    const p = ballOn({ x: 0, z: 0 }, Math.cos(a), Math.sin(a), 12);
    const beforeX = p.momX;
    updateFloorFx(0.05);
    expect(p.grooveHopT).toBe(0); // deflected, not launched
    expect(p.momX).toBeGreaterThan(beforeX); // bent toward +X, the cut's line
    expect(Math.hypot(p.momX, p.momZ)).toBeCloseTo(1); // stays a unit heading
  });

  it("the hop arcs up and returns the sprite to the floor", () => {
    carveGroove(0, 0, 14, 1, 0);
    const heights: number[] = [];
    const p = ballOn({ x: 0, z: 0 }, 0, 1, 14);
    p.sprite = {
      mesh: { position: { y: 0 } },
      setElevation: (h: number) => heights.push(h),
    } as unknown as typeof p.sprite;
    updateFloorFx(0.016);
    for (let i = 0; i < 30; i++) updateGrooveHop(0.016);
    expect(Math.max(...heights)).toBeGreaterThan(0); // it left the ground
    expect(heights[heights.length - 1]).toBe(0); // and came back down
    expect(p.grooveHopT).toBe(0);
  });

  it("REGRESSION: a dense trail cannot buzz the ball with back-to-back hops", () => {
    // Lay a run of cuts, then drive across them: the cooldown must gate it.
    for (let i = 0; i < 12; i++) carveGroove(i * GROOVE_SPACING * 1.1, 0, 14, 1, 0);
    const p = ballOn({ x: 0, z: 0 }, 0, 1, 14);
    updateFloorFx(0.016);
    expect(p.grooveHopT).toBeGreaterThan(0);
    const speedAfterFirst = p.momSpeed;
    // Immediately overlapping more cuts must NOT stack another hop/speed loss.
    updateFloorFx(0.016);
    expect(p.momSpeed).toBeCloseTo(speedAfterFirst);
  });
});
