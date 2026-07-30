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
import { LASER_DURATION, LASER_TRAIL_LIFE, LASER_ZIG_ANGLE, LASER_ZIG_PERIOD } from "../constants";

function makeGrid(size: number, fill: number = T_FLOOR): Grid {
  return { w: size, h: size, t: new Uint8Array(size * size).fill(fill), shapes: new Uint8Array(size * size) };
}

/** Records every trail point and laser mark pushed, so the path can be inspected. */
function fakeVfx() {
  const points: Array<{ x: number; z: number; color: number; life?: number; style?: string }> = [];
  const marks: Array<{ x: number; z: number; dirx: number; dirz: number }> = [];
  let clears = 0;
  return {
    points,
    marks,
    clears: () => clears,
    vfx: {
      trail: (x: number, _y: number, z: number, color: number, life?: number, style?: string) =>
        points.push({ x, z, color, life, style }),
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

  /**
   * ── THIS ASSERTION USED TO SAY THE OPPOSITE ──
   * It read "gives the laser a SHORTER tail than the bolt — a dot with a stub,
   * not a beam", pinning the original brief: the marks carried the path and the
   * ribbon was a 0.12s stub, because an early cut drew one long line sliding
   * across the room.
   *
   * The brief CHANGED on request (2026-07-29): the laser should leave the
   * spy-movie beam grid — the legs it has already drawn stay up and accumulate
   * into a lattice. So the laser now holds the LONGER life of the two, and the
   * property worth pinning is no longer "which is shorter" but that the two
   * flavours still differ in BOTH knobs the ribbon carries per point. One
   * object serves two reads; if it ever stops carrying them per point, one of
   * the two silently becomes the other.
   */
  it("gives the laser a LONGER, HELD tail than the bolt's tapered streak", () => {
    enterRicochetForm("bolt");
    updateRicochet(1 / 60);
    const bolt = rec.points[0];
    enterRicochetForm("laser");
    updateRicochet(1 / 60);
    const laser = rec.points[0];
    expect(laser.life!).toBeGreaterThan(bolt.life!);
    // The STYLE is the other half: a long life drawn in the bolt's language is a
    // dim thin smear, not a lattice — see TRAIL_STYLES.
    expect(laser.style).toBe("beam");
    expect(bolt.style).toBe("taper");
  });

  it("keeps the whole cast's path alive — the lattice is the effect", () => {
    // The life has to cover most of the cast or the oldest legs are gone before
    // the newest are drawn, and "it bounces off the walls and the beams stay
    // up" is the entire ask.
    expect(LASER_TRAIL_LIFE / LASER_DURATION).toBeGreaterThan(0.75);
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
 * Originally the whole "it is a laser" read: with only a 0.12s stub of tail, a
 * straight leg between two walls drew as a beam sliding sideways, so the form
 * kinked its own heading nine times a second.
 *
 * The beam grid (2026-07-29) made the straight legs the effect instead, and the
 * kink was demoted to a lean — 0.3s and 0.16rad. The PROPERTY these tests exist
 * for survives that and is still worth pinning: the laser bends its own path and
 * the bolt does not, so a room with no walls in reach can tell them apart. What
 * changed is that the thresholds are now DERIVED from the two constants instead
 * of hardcoding the rate they had when the tests were written — the version that
 * did assert "≥6 corners of ≥0.3rad in 0.5s", which is not a property, it is a
 * transcription of one tuning.
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

  /**
   * A room with no walls in reach — every turn recorded here is the form's.
   *
   * ── THE SIZE IS LOAD-BEARING, AND world (0,0) IS THE MIDDLE ──
   * `moveCircle` maps world to grid with `gx = x + g.w / 2`, so the origin is
   * the room's CENTRE and the clearance in every direction is half the width.
   * At 61 that is 30 units, which was fine for a 0.5s run (16 units of path) and
   * stopped being fine the moment the zigzag test ran long enough to measure a
   * slower kink rate: 1.2s of laser is 38 units, the ball reached the boundary,
   * and `bounceCombo` going to 1 made the failure point at the kink rate rather
   * than at the room. 121 gives 60 units of clearance — more than a full cast.
   *
   * (Moving the START to `ROOM / 2` to "centre" it does the opposite: that is
   * grid coordinate 121, i.e. straight into the far wall. Ten bounces, instantly.)
   */
  const ROOM = 121;
  function openRoom() {
    state.grid = makeGrid(ROOM);
    state.player!.x = 0;
    state.player!.z = 0;
    state.player!.momX = 1;
    state.player!.momZ = 0;
    state.player!.bounceCombo = 0;
  }

  it("puts corners in the path with no wall anywhere near", () => {
    openRoom();
    enterRicochetForm("laser");
    // Long enough for several kinks AT THE CURRENT PERIOD, so the test scales
    // with the tuning instead of expiring on it.
    const secs = LASER_ZIG_PERIOD * 4;
    for (let i = 0; i < Math.ceil(secs * 60); i++) updateRicochet(1 / 60);
    // Nothing was hit, so nothing external bent the path.
    expect(state.player!.bounceCombo).toBe(0);
    // Each kink turns LASER_ZIG_ANGLE × (0.7 … 1.3); half of it is a threshold
    // no kink can miss and no straight leg can reach.
    const turned = corners(rec.points, LASER_ZIG_ANGLE * 0.5);
    expect(turned, `expected ~4 kinks in ${secs.toFixed(2)}s, saw ${turned}`).toBeGreaterThanOrEqual(2);
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
