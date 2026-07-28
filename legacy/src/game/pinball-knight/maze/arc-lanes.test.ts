/**
 * BOOSTER LANES — the tangential accelerator on a curved sweep.
 *
 * The one-way GRAIN is the whole design, and it is the part that fails
 * silently: a lane that grabs a ball running the wrong way would fling players
 * backwards into the corner they just escaped, and nothing in the visuals would
 * explain it. So the direction gate gets the most cases here.
 *
 * Pure geometry + physics, no DOM/three.
 */
import { describe, it, expect } from "vitest";
import { laneBandAt, laneTangent, angleInSpan, type ArcFeature, type LaneBand } from "../engine/tile-shape";
import { orientArcRails, railExit, RAIL_RIDE_INSET, LANE_BAND_FRAC } from "./arc-sweeps";
import { buildFlowField, isDownhill } from "./flow-orient";
import { type Grid, T_FLOOR, T_WALL, T_STAIRS } from "./generator";
import { PLAYER_R } from "../constants";

const HALF_PI = Math.PI / 2;

/** A quarter-circle convex guide centred at the origin, radius 3, facing SE. */
function feature(lanes: LaneBand[], solidOut = false): ArcFeature {
  return { cx: 0, cz: 0, r: 3, a0: 0, span: HALF_PI, solidOut: solidOut || undefined, lanes };
}

/** A lane covering the feature's whole span, throwing `cw`. */
function lane(cw: boolean, over = HALF_PI): LaneBand {
  return { a0: 0, span: over, cw, cooldownT: 0, hitT: -1 };
}

/** A point on the feature's circle at angle `a`. */
const onArc = (a: number, r = 3): { x: number; z: number } => ({ x: Math.cos(a) * r, z: Math.sin(a) * r });

describe("laneTangent", () => {
  it("points along increasing angle when cw, and reverses when not", () => {
    const f = feature([lane(true)]);
    const p = onArc(0); // due east of centre
    const t = laneTangent(f, f.lanes![0], p.x, p.z);
    // At angle 0 the outward radial is +x, so the increasing-angle tangent is +z.
    expect(t.tx).toBeCloseTo(0, 6);
    expect(t.tz).toBeCloseTo(1, 6);

    const g = feature([lane(false)]);
    const t2 = laneTangent(g, g.lanes![0], p.x, p.z);
    expect(t2.tz).toBeCloseTo(-1, 6);
  });

  it("is a unit vector all the way round the sweep", () => {
    const f = feature([lane(true)]);
    for (const a of [0, 0.3, 0.8, 1.2, HALF_PI]) {
      const p = onArc(a);
      const t = laneTangent(f, f.lanes![0], p.x, p.z);
      expect(Math.hypot(t.tx, t.tz)).toBeCloseTo(1, 6);
    }
  });

  it("is perpendicular to the radial — a lane carries, never pushes off", () => {
    // If the tangent had any radial component the boost would shove the ball
    // into or out of the wall instead of around it.
    const f = feature([lane(true)]);
    const a = 0.7;
    const p = onArc(a);
    const t = laneTangent(f, f.lanes![0], p.x, p.z);
    const dot = (p.x / 3) * t.tx + (p.z / 3) * t.tz;
    expect(Math.abs(dot)).toBeLessThan(1e-9);
  });
});

describe("laneBandAt — the one-way grain", () => {
  it("grabs a ball travelling WITH the lane", () => {
    const f = feature([lane(true)]);
    const p = onArc(0.5);
    const t = laneTangent(f, f.lanes![0], p.x, p.z);
    expect(laneBandAt(f, p.x, p.z, t.tx, t.tz)).not.toBeNull();
  });

  it("IGNORES a ball travelling against it — the lane can never reverse you", () => {
    const f = feature([lane(true)]);
    const p = onArc(0.5);
    const t = laneTangent(f, f.lanes![0], p.x, p.z);
    expect(laneBandAt(f, p.x, p.z, -t.tx, -t.tz)).toBeNull();
  });

  it("ignores a dead-on approach with no tangential travel at all", () => {
    // Rolling straight at the wall is a bank, not a boost — there is no "along
    // the curve" component to amplify.
    const f = feature([lane(true)]);
    const p = onArc(0.5);
    const radialIn = { x: -p.x / 3, z: -p.z / 3 };
    expect(laneBandAt(f, p.x, p.z, radialIn.x, radialIn.z)).toBeNull();
  });

  it("grabs a glancing approach that still has the right grain", () => {
    // Mostly into the wall, slightly along it — that IS a line the lane should
    // reward, or lanes would only fire on a perfect tangent nobody can hit.
    const f = feature([lane(true)]);
    const p = onArc(0.5);
    const t = laneTangent(f, f.lanes![0], p.x, p.z);
    const inward = { x: -p.x / 3, z: -p.z / 3 };
    const mx = inward.x * 0.9 + t.tx * 0.1;
    const mz = inward.z * 0.9 + t.tz * 0.1;
    expect(laneBandAt(f, p.x, p.z, mx, mz)).not.toBeNull();
  });

  it("respects the counter-clockwise direction symmetrically", () => {
    const f = feature([lane(false)]);
    const p = onArc(0.5);
    const t = laneTangent(f, f.lanes![0], p.x, p.z);
    expect(laneBandAt(f, p.x, p.z, t.tx, t.tz)).not.toBeNull();
    expect(laneBandAt(f, p.x, p.z, -t.tx, -t.tz)).toBeNull();
  });
});

describe("laneBandAt — spans and cooldown", () => {
  it("returns null outside the band's angular span", () => {
    // Band covers only the first third of the sweep.
    const band: LaneBand = { a0: 0, span: HALF_PI / 3, cw: true, cooldownT: 0, hitT: -1 };
    const f = feature([band]);
    const inside = onArc(0.2);
    const outside = onArc(1.4);
    const tIn = laneTangent(f, band, inside.x, inside.z);
    const tOut = laneTangent(f, band, outside.x, outside.z);
    expect(laneBandAt(f, inside.x, inside.z, tIn.tx, tIn.tz)).not.toBeNull();
    expect(laneBandAt(f, outside.x, outside.z, tOut.tx, tOut.tz)).toBeNull();
    expect(angleInSpan(1.4, band.a0, band.span)).toBe(false);
  });

  it("is dead while on cooldown — a spent lane is just a wall", () => {
    const band = lane(true);
    band.cooldownT = 0.2;
    const f = feature([band]);
    const p = onArc(0.5);
    const t = laneTangent(f, band, p.x, p.z);
    expect(laneBandAt(f, p.x, p.z, t.tx, t.tz)).toBeNull();
  });

  it("is null for a feature with no lanes at all", () => {
    const f: ArcFeature = { cx: 0, cz: 0, r: 3, a0: 0, span: HALF_PI };
    expect(laneBandAt(f, 3, 0, 0, 1)).toBeNull();
  });

  it("does not divide by zero at the arc centre", () => {
    const f = feature([lane(true)]);
    expect(() => laneBandAt(f, f.cx, f.cz, 1, 0)).not.toThrow();
    expect(laneBandAt(f, f.cx, f.cz, 1, 0)).toBeNull();
  });

  it("works on a CONCAVE bowl, where lanes are actually authored", () => {
    // Concave features are solid outside; the contact angle maths is identical,
    // which is the point — one circle, one angle frame, both polarities.
    const f = feature([lane(true)], true);
    const p = onArc(0.5);
    const t = laneTangent(f, f.lanes![0], p.x, p.z);
    expect(laneBandAt(f, p.x, p.z, t.tx, t.tz)).not.toBeNull();
  });
});

// ── ORIENTATION: which way round the bowl the rail actually throws ──────────
//
// Everything above tests the lane's RUNTIME grain — given a cw, who gets
// grabbed. These test where that cw comes from, which until this wave was
// `rng() < 0.5` with nothing checking what lay past the exit.

describe("railExit — where a rail spits you out", () => {
  /** An open floor grid with a solid border, for exit-tile lookups. */
  function openGrid(w = 24, h = 24): Grid {
    const g: Grid = { w, h, t: new Uint8Array(w * h), shapes: new Uint8Array(w * h) };
    for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) g.t[j * w + i] = T_FLOOR;
    return g;
  }

  it("leaves a quarter-turn along the cardinal at the end it exits by", () => {
    // The SE quadrant of a circle centred at (12,12): a0 = 0 spans to π/2.
    // Going clockwise you leave at π/2 — the SOUTH point — heading WEST.
    // Going the other way you leave at 0 — the EAST point — heading NORTH.
    // Pinned because every gate below trusts this snap.
    const g = openGrid();
    const f: ArcFeature = { cx: 12, cz: 12, r: 3, a0: 0, span: HALF_PI, solidOut: true };
    const cwExit = railExit(g, f, lane(true), true)!;
    expect(cwExit).toBeTruthy();
    expect([cwExit.di, cwExit.dj]).toEqual([-1, 0]);
    const ccwExit = railExit(g, f, lane(false), false)!;
    expect(ccwExit).toBeTruthy();
    expect([ccwExit.di, ccwExit.dj]).toEqual([0, -1]);
  });

  it("rides at the radius the COLLIDER uses, inside a bowl and outside a guide", () => {
    // Not a restatement of the constant: it pins that concave and convex inset
    // in OPPOSITE directions, which is the half of the contract a single
    // `toBe(PLAYER_R)` assertion would miss.
    const g = openGrid();
    const concave: ArcFeature = { cx: 12, cz: 12, r: 4, a0: 0, span: HALF_PI, solidOut: true };
    const convex: ArcFeature = { cx: 12, cz: 12, r: 4, a0: 0, span: HALF_PI };
    const cd = Math.hypot(railExit(g, concave, lane(true), true)!.i + 0.5 - 12, railExit(g, concave, lane(true), true)!.j + 0.5 - 12);
    const vd = Math.hypot(railExit(g, convex, lane(true), true)!.i + 0.5 - 12, railExit(g, convex, lane(true), true)!.j + 0.5 - 12);
    expect(cd).toBeLessThan(vd);
  });

  it("RAIL_RIDE_INSET is the player's collision radius, not an estimate", () => {
    // arc-sweeps duplicates the number to keep its authoring/feel split; this is
    // the assertion that stops the two drifting.
    expect(RAIL_RIDE_INSET).toBe(PLAYER_R);
  });

  it("the tangent-to-cardinal snap error stays inside (1 - LANE_BAND_FRAC)/2 x span", () => {
    // The whole reason `railExit` may hand a CARDINAL to the 4-connected Φ
    // predicates. At the shipped 0.94 over a quadrant that is 2.7 degrees;
    // widening the band would break the argument, and this fails when it does.
    const bound = ((1 - LANE_BAND_FRAC) / 2) * HALF_PI;
    expect(bound).toBeLessThan(0.05); // ~2.9 degrees
    const a0 = 0;
    const band = { a0: a0 + bound, span: HALF_PI * LANE_BAND_FRAC, cw: true, cooldownT: 0, hitT: -1 };
    const aE = band.a0 + band.span;
    // The exact tangent at the exit, against the cardinal it snaps to.
    const tx = -Math.sin(aE);
    const tz = Math.cos(aE);
    const [sx, sz] = Math.abs(tx) >= Math.abs(tz) ? [Math.sign(tx), 0] : [0, Math.sign(tz)];
    const err = Math.acos(Math.min(1, Math.abs(tx * sx + tz * sz)));
    expect(err).toBeLessThanOrEqual(bound + 1e-9);
  });
});

describe("orientArcRails", () => {
  function grid(w: number, h: number): Grid {
    const g: Grid = { w, h, t: new Uint8Array(w * h), shapes: new Uint8Array(w * h) };
    for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) g.t[j * w + i] = T_FLOOR;
    return g;
  }

  it("drops a rail whose exits are both walled in", () => {
    // A bowl in a sealed pocket: nothing past either end, so neither way round
    // is a racing line and the honest answer is no rail at all.
    const g = grid(24, 24);
    for (let j = 0; j < 24; j++) for (let i = 0; i < 24; i++) if (i > 14 || j > 14 || i < 9 || j < 9) g.t[j * 24 + i] = T_WALL;
    const f: ArcFeature = { cx: 12, cz: 12, r: 3, a0: 0, span: HALF_PI, solidOut: true, lanes: [lane(true)] };
    g.arcs = [f];
    const phi = buildFlowField(g, { i: 12, j: 12 });
    const stats = orientArcRails(g, phi);
    expect(stats.dropped).toBe(1);
    expect(f.lanes).toBeUndefined();
  });

  it("flips a rail whose authored direction throws away from the stairs", () => {
    // One long east-west hall with the exit at the WEST end, so Φ falls westward
    // everywhere. A rail authored to throw east is throwing you back up the
    // floor; the pass must turn it round rather than drop it.
    const g = grid(40, 12);
    g.t[6 * 40 + 2] = T_STAIRS;
    const phi = buildFlowField(g, { i: 2, j: 6 });
    // The SE quadrant, as pinned above: cw leaves WEST (down-Φ, toward the
    // exit), ccw leaves NORTH (across the contour, so not downhill). Authored
    // ccw, i.e. the wrong way — which is exactly what a coin flip produces half
    // the time, and what nothing on this floor could previously detect.
    const f: ArcFeature = { cx: 20, cz: 6, r: 3, a0: 0, span: HALF_PI, solidOut: true, lanes: [lane(false, HALF_PI)] };
    g.arcs = [f];
    const before = f.lanes![0].cw;
    expect(before).toBe(false);
    const stats = orientArcRails(g, phi);
    expect(stats.dropped).toBe(0);
    expect(f.lanes).toBeTruthy();
    // Whichever way it started, it must end up throwing DOWN-Φ.
    const x = railExit(g, f, f.lanes![0], f.lanes![0].cw)!;
    expect(x).toBeTruthy();
    expect(isDownhill(g, phi, x.i, x.j, x.di, x.dj)).toBe(true);
    expect(stats.flipped + stats.kept).toBe(1);
    if (stats.flipped === 1) expect(f.lanes![0].cw).toBe(!before);
  });

  it("NEVER writes a tile, a shape or an arcIdx", () => {
    // ── THE ASSERTION THAT MAKES THIS PASS SAFE TO INSERT MID-PIPELINE.
    //
    // It runs between the arc fixed point and the relaxation bookkeeping in
    // buildTrackFloor. If it could touch geometry it would re-roll every floor
    // in the game and invalidate every pinned layout test; because it only ever
    // writes `feature.lanes`, floors before and after are byte-identical.
    const g = grid(30, 30);
    g.arcs = [
      { cx: 10, cz: 10, r: 3, a0: 0, span: HALF_PI, solidOut: true, lanes: [lane(true)] },
      { cx: 20, cz: 20, r: 2, a0: Math.PI, span: HALF_PI, solidOut: true, lanes: [lane(false)] },
    ];
    g.arcIdx = new Int16Array(30 * 30).fill(-1);
    const tiles = Uint8Array.from(g.t);
    const shapes = Uint8Array.from(g.shapes);
    const arcIdx = Int16Array.from(g.arcIdx);
    orientArcRails(g, buildFlowField(g, { i: 5, j: 5 }));
    expect(Array.from(g.t)).toEqual(Array.from(tiles));
    expect(Array.from(g.shapes)).toEqual(Array.from(shapes));
    expect(Array.from(g.arcIdx!)).toEqual(Array.from(arcIdx));
    // …and the features' own geometry is untouched too — only `lanes`.
    expect(g.arcs.map((f) => [f.cx, f.cz, f.r, f.a0, f.span])).toEqual([
      [10, 10, 3, 0, HALF_PI],
      [20, 20, 2, Math.PI, HALF_PI],
    ]);
  });

  it("is idempotent — running it twice changes nothing more", () => {
    // A pass that keeps flipping on re-entry would mean the score is not a
    // function of the finished grid, which is the property the gate relies on.
    const g = grid(40, 12);
    g.t[6 * 40 + 2] = T_STAIRS;
    g.arcs = [{ cx: 20, cz: 6, r: 3, a0: 0, span: HALF_PI, solidOut: true, lanes: [lane(false, HALF_PI)] }];
    const phi = buildFlowField(g, { i: 2, j: 6 });
    orientArcRails(g, phi);
    const cw1 = g.arcs[0].lanes?.[0].cw;
    const second = orientArcRails(g, phi);
    expect(second.flipped).toBe(0);
    expect(second.dropped).toBe(0);
    expect(g.arcs[0].lanes?.[0].cw).toBe(cw1);
  });
});
