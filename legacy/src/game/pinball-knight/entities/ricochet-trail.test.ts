/**
 * THE RICOCHET TRAIL — the streak that carries the form's direction.
 *
 * The bug this exists to prevent shipped once already: both forms were drawn as
 * a beam lying along the sprite's x axis, and an actor sprite is a
 * camera-facing billboard whose art cannot rotate. So the "laser" pointed east
 * while the ball travelled north-west, every time. The fix moves direction out
 * of the art and into the PATH, which means these are now the tests that keep
 * the heading honest.
 *
 * What matters here:
 *   1. the trail is fed per SUBSTEP (a once-a-frame sample cuts corners off
 *      bounces and draws a straight line through the wall the ball just hit),
 *   2. the points follow the ball's ACTUAL path,
 *   3. a new form does not inherit the previous one's tail.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { state } from "../state";
import { enterRicochetForm, updateRicochet, RICOCHET_FLAVORS } from "./ricochet-form";
import { setTile, type Grid } from "../engine/grid";
import { T_WALL, T_FLOOR } from "../maze/generator";

function makeGrid(size: number, fill: number = T_FLOOR): Grid {
  return { w: size, h: size, t: new Uint8Array(size * size).fill(fill), shapes: new Uint8Array(size * size) };
}

/** Records every trail point and laser mark pushed, so the path can be inspected. */
function fakeVfx() {
  const points: Array<{ x: number; z: number; color: number; life?: number }> = [];
  const marks: Array<{ x: number; z: number; dirx: number; dirz: number }> = [];
  let clears = 0;
  return {
    points,
    marks,
    clears: () => clears,
    vfx: {
      trail: (x: number, _y: number, z: number, color: number, life?: number) => points.push({ x, z, color, life }),
      laserMark: (x: number, _y: number, z: number, dirx: number, dirz: number) => marks.push({ x, z, dirx, dirz }),
      trailClear: () => {
        clears++;
        points.length = 0;
        marks.length = 0;
      },
      sparks: () => {},
      burst: () => {},
      ghost: () => {},
    },
  };
}

let rec: ReturnType<typeof fakeVfx>;

beforeEach(() => {
  const g = makeGrid(11);
  for (let i = 0; i < 11; i++) {
    setTile(g, i, 0, T_WALL);
    setTile(g, i, 10, T_WALL);
    setTile(g, 0, i, T_WALL);
    setTile(g, 10, i, T_WALL);
  }
  state.grid = g;
  state.zombies = [];
  state.dbgMaterialEnabled = true;
  rec = fakeVfx();
  state.vfx = rec.vfx as unknown as typeof state.vfx;
  state.player = {
    ...(state.player ?? {}),
    x: 0,
    z: 0,
    momX: 1,
    momZ: 0,
    momSpeed: 0,
    hp: 5,
    iframes: 0,
    material: null,
    materialT: 0,
    ricochetT: 0,
    ricochetFlavor: "laser",
    ricochetTickT: 0,
    bounceCombo: 0,
  } as typeof state.player;
});

describe("the ricochet trail carries the direction the sprite cannot", () => {
  it("pushes a point per SUBSTEP, not per frame", () => {
    enterRicochetForm("laser");
    rec.points.length = 0;
    updateRicochet(1 / 60);
    // Sub-stepping is not a detail: at laser speed one 60Hz step is several
    // tiles, so a single sample per frame would draw the path as a straight
    // line through whatever it bounced off mid-step.
    expect(rec.points.length).toBeGreaterThan(1);
  });

  it("traces the ball's ACTUAL path, not a fixed axis", () => {
    enterRicochetForm("laser");
    // Send it north-west; the old bug drew the beam along +x regardless.
    state.player!.momX = -0.7;
    state.player!.momZ = -0.7;
    state.player!.x = 0;
    state.player!.z = 0;
    rec.points.length = 0;
    updateRicochet(1 / 60);
    const first = rec.points[0];
    const last = rec.points[rec.points.length - 1];
    expect(last.x).toBeLessThan(first.x);
    expect(last.z).toBeLessThan(first.z);
    // …and every recorded point is where the ball actually was.
    expect(last.x).toBeCloseTo(state.player!.x, 5);
    expect(last.z).toBeCloseTo(state.player!.z, 5);
  });

  it("keeps the corner when it bounces mid-step", () => {
    enterRicochetForm("bolt");
    // Park it hard against the east wall heading into it, so a bounce is
    // guaranteed inside the frame.
    state.player!.x = 4.2;
    state.player!.z = 0;
    state.player!.momX = 1;
    state.player!.momZ = 0;
    rec.points.length = 0;
    for (let i = 0; i < 8; i++) updateRicochet(1 / 60);
    const xs = rec.points.map((p) => p.x);
    // The path must REVERSE somewhere: a straight run of increasing x would
    // mean the samples skipped over the wall contact.
    const turned = xs.some((x, i) => i > 0 && x < xs[i - 1]);
    expect(turned, "the trail never turned — it tunnelled through the bounce").toBe(true);
  });

  it("tints the trail with the flavour, so bolt and laser read apart", () => {
    enterRicochetForm("bolt");
    updateRicochet(1 / 60);
    expect(rec.points[0].color).toBe(RICOCHET_FLAVORS.bolt.tint);
    enterRicochetForm("laser");
    updateRicochet(1 / 60);
    expect(rec.points[rec.points.length - 1].color).toBe(RICOCHET_FLAVORS.laser.tint);
    expect(RICOCHET_FLAVORS.bolt.tint).not.toBe(RICOCHET_FLAVORS.laser.tint);
  });

  it("clears the tail on entry — a new cast never inherits the last one's path", () => {
    enterRicochetForm("laser");
    for (let i = 0; i < 5; i++) updateRicochet(1 / 60);
    expect(rec.points.length).toBeGreaterThan(0);
    enterRicochetForm("bolt");
    // The ribbon is a keep-alive object, not a per-cast one: without an explicit
    // clear the new form would start with a streak leading back to wherever the
    // previous one ended.
    expect(rec.points.length).toBe(0);
    expect(rec.clears()).toBeGreaterThanOrEqual(2);
  });

  it("gives the laser a SHORTER tail than the bolt — a dot with a stub, not a beam", () => {
    enterRicochetForm("bolt");
    updateRicochet(1 / 60);
    const boltLife = rec.points[0].life!;
    enterRicochetForm("laser");
    updateRicochet(1 / 60);
    const laserLife = rec.points[0].life!;
    // The ribbon is one object serving two reads. If it ever stops carrying a
    // per-point life the laser silently grows the bolt's room-long streak back.
    expect(laserLife).toBeLessThan(boltLife);
  });

  it("stops feeding the trail once the form lapses", () => {
    enterRicochetForm("laser");
    for (let i = 0; i < 60 * 5; i++) updateRicochet(1 / 60);
    rec.points.length = 0;
    updateRicochet(1 / 60);
    // Nothing more is pushed; the ribbon fades on its own from here.
    expect(rec.points.length).toBe(0);
  });
});

/**
 * THE ZIGZAG — why the laser turns without touching anything.
 *
 * Bouncing off walls is not enough to make a laser read as one. Between two
 * walls the path is a straight line, and at LASER_SPEED the ribbon drew that
 * line honestly: a long beam sliding sideways across the room. These tests pin
 * the fix at the level it lives — the PATH, in an open room where every corner
 * in it must have come from the form itself.
 */
describe("the laser zigzags on its own; the bolt does not", () => {
  /** Corners in a recorded path: how many times it turned by more than `min`. */
  function corners(pts: Array<{ x: number; z: number }>, min = 0.3): number {
    const angs: number[] = [];
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x;
      const dz = pts[i].z - pts[i - 1].z;
      if (Math.hypot(dx, dz) > 1e-6) angs.push(Math.atan2(dz, dx));
    }
    let n = 0;
    for (let i = 1; i < angs.length; i++) {
      let d = Math.abs(angs[i] - angs[i - 1]);
      if (d > Math.PI) d = Math.abs(d - 2 * Math.PI);
      if (d > min) n++;
    }
    return n;
  }

  /** A room with no walls in reach — every turn recorded here is the form's. */
  function openRoom() {
    state.grid = makeGrid(61);
    state.player!.x = 0;
    state.player!.z = 0;
    state.player!.momX = 1;
    state.player!.momZ = 0;
    state.player!.bounceCombo = 0;
  }

  it("puts corners in the path with no wall anywhere near", () => {
    openRoom();
    enterRicochetForm("laser");
    for (let i = 0; i < 30; i++) updateRicochet(1 / 60); // 0.5s
    // Nothing was hit, so nothing external bent the path.
    expect(state.player!.bounceCombo).toBe(0);
    // 0.5s at LASER_ZIG_PERIOD (0.055) is ~9 kinks; allow for the sub-step
    // boundary and a slack frame at each end.
    expect(corners(rec.points)).toBeGreaterThanOrEqual(6);
  });

  it("still crosses the room — a saw-tooth, not a random walk on the spot", () => {
    openRoom();
    enterRicochetForm("laser");
    for (let i = 0; i < 30; i++) updateRicochet(1 / 60);
    // Alternating the kink SIGN is what buys this. With a signed random walk
    // the heading diffuses and the form mills around where it started, which
    // makes an escape ability that goes nowhere.
    const travelled = Math.hypot(state.player!.x, state.player!.z);
    expect(travelled).toBeGreaterThan(8);
  });

  it("leaves the bolt travelling straight between bounces", () => {
    openRoom();
    enterRicochetForm("bolt");
    for (let i = 0; i < 30; i++) updateRicochet(1 / 60);
    expect(state.player!.bounceCombo).toBe(0);
    // The bolt's read is a thing being thrown around a room: a smooth arc
    // between two walls. If the zigzag ever leaks into it, the two forms stop
    // looking like different abilities.
    expect(corners(rec.points)).toBe(0);
    expect(rec.marks.length).toBe(0);
  });

  it("stamps a cross chain along the path — the marks ARE the effect", () => {
    openRoom();
    enterRicochetForm("laser");
    for (let i = 0; i < 30; i++) updateRicochet(1 / 60);
    // 0.5s covers 16 units at LASER_SPEED: ~19 distance stamps plus a kink
    // stamp each. The floor is deliberately loose — what must not happen is
    // "a handful", which is what a per-frame or per-second cadence would give.
    expect(rec.marks.length).toBeGreaterThan(15);
    // Every mark carries the heading it was stamped at: the cross is built in
    // the plane of travel, so a zeroed direction would collapse it to a bar.
    for (const m of rec.marks) expect(Math.hypot(m.dirx, m.dirz)).toBeGreaterThan(0.5);
  });
});
