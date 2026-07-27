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
