/**
 * THE CLAIM THE FUNNEL RESTS ON, tested on the APPROXIMATION.
 *
 * It is easy and useless to assert that an ellipse focuses — that is a theorem.
 * What has to hold is that the CHAIN OF CIRCULAR ARCS this module emits in an
 * ellipse's place still focuses, still reads as one wall to `arc-contract.ts`,
 * and still deflects the way the shipped collider will deflect. So every test
 * here runs against the emitted `ArcFeature[]`, never against the ideal curve.
 */
import { describe, it, expect } from "vitest";
import {
  arcChainFromSamples,
  ellipseFromFoci,
  ellipseSamples,
  parabolaSamples,
  parabolicJaws,
  nearestOnChain,
  normalIntersection,
  MAX_ARC_RADIUS,
  type Pt,
} from "./conic-fit";
import { junctionCheck, tangentDelta, tangentAngle, TANGENT_TOL, SURFACE_TOL } from "./arc-contract";
import type { ArcFeature } from "../engine/tile-shape";

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * March a ray until it meets the chain, then reflect it once.
 *
 * Deliberately a plain geometric march rather than the tile collider: this is
 * asking whether the SHAPE focuses, and putting a grid under it would mix in
 * whatever the surrounding tiles do. The collider is exercised end-to-end by
 * the funnel census instead.
 */
function reflectOnce(
  chain: readonly ArcFeature[],
  from: Pt,
  dir: Pt,
  maxDist = 60,
  step = 0.002,
): { hit: Pt; dir: Pt } | null {
  let x = from.x;
  let z = from.z;
  for (let d = 0; d < maxDist; d += step) {
    x += dir.x * step;
    z += dir.z * step;
    const n = nearestOnChain(chain, x, z);
    if (!n || n.gap > step * 1.5) continue;
    // `nearestOnChain` reports the normal pointing into free space.
    const vn = dir.x * n.nx + dir.z * n.nz;
    if (vn >= 0) continue; // leaving the face, not arriving
    return { hit: { x, z }, dir: { x: dir.x - 2 * vn * n.nx, z: dir.z - 2 * vn * n.nz } };
  }
  return null;
}

/** Closest approach of the ray (p, d) to the point q. */
function missDistance(p: Pt, d: Pt, q: Pt): number {
  const t = (q.x - p.x) * d.x + (q.z - p.z) * d.z;
  if (t <= 0) return dist(p, q); // going away from it
  return Math.hypot(p.x + d.x * t - q.x, p.z + d.z * t - q.z);
}

describe("arc chain construction", () => {
  it("consecutive links share a tangent EXACTLY — the kink is zero, not small", () => {
    const e = ellipseFromFoci({ x: -3, z: 0 }, { x: 3, z: 0 }, 5)!;
    const chain = arcChainFromSamples(ellipseSamples(e, 0.4, 2.7, 10), true, "funnel");
    expect(chain.length).toBeGreaterThan(6);

    for (let k = 0; k + 1 < chain.length; k++) {
      const a = chain[k];
      const b = chain[k + 1];
      // The join is the point both arcs share; take it off `a`'s far end. Which
      // end that is depends on the stored winding, so test the one that b also
      // touches.
      const ends = [a.a0, a.a0 + a.span].map((ang) => ({ x: a.cx + Math.cos(ang) * a.r, z: a.cz + Math.sin(ang) * a.r }));
      const join = ends.reduce((best, p) => (Math.abs(Math.hypot(p.x - b.cx, p.z - b.cz) - b.r) < Math.abs(Math.hypot(best.x - b.cx, best.z - b.cz) - b.r) ? p : best));
      const kink = tangentDelta(tangentAngle(a, join.x, join.z), tangentAngle(b, join.x, join.z));
      expect(kink).toBeLessThan(1e-6);
    }
  });

  it("every join passes the arc contract that judges two curves as one wall", () => {
    const e = ellipseFromFoci({ x: -4, z: 1 }, { x: 4, z: -1 }, 6)!;
    const chain = arcChainFromSamples(ellipseSamples(e, 0.2, 2.9, 12), true, "funnel");
    for (let k = 0; k + 1 < chain.length; k++) {
      const a = chain[k];
      const b = chain[k + 1];
      const ends = [a.a0, a.a0 + a.span].map((ang) => ({ x: a.cx + Math.cos(ang) * a.r, z: a.cz + Math.sin(ang) * a.r }));
      const join = ends.reduce((best, p) => (Math.abs(Math.hypot(p.x - b.cx, p.z - b.cz) - b.r) < Math.abs(Math.hypot(best.x - b.cx, best.z - b.cz) - b.r) ? p : best));
      const c = junctionCheck(a, b, join.x, join.z);
      expect(c.ok).toBe(true);
      expect(c.kink).toBeLessThan(TANGENT_TOL);
      expect(c.step).toBeLessThan(SURFACE_TOL);
    }
  });

  it("the C0 step at a join stays far under the ball radius", () => {
    const e = ellipseFromFoci({ x: -3, z: 0 }, { x: 3, z: 0 }, 5)!;
    const chain = arcChainFromSamples(ellipseSamples(e, 0.3, 2.8, 10), true, "funnel");
    let worst = 0;
    for (let k = 0; k + 1 < chain.length; k++) {
      const a = chain[k];
      const b = chain[k + 1];
      const ends = [a.a0, a.a0 + a.span].map((ang) => ({ x: a.cx + Math.cos(ang) * a.r, z: a.cz + Math.sin(ang) * a.r }));
      const join = ends.reduce((best, p) => (Math.abs(Math.hypot(p.x - b.cx, p.z - b.cz) - b.r) < Math.abs(Math.hypot(best.x - b.cx, best.z - b.cz) - b.r) ? p : best));
      worst = Math.max(worst, Math.abs(Math.hypot(join.x - b.cx, join.z - b.cz) - b.r));
    }
    // PLAYER_R is 0.3. A step the ball cannot feel is the bar, not SURFACE_TOL.
    expect(worst).toBeLessThan(0.05);
  });

  it("the chain tracks the true conic, not just itself", () => {
    const e = ellipseFromFoci({ x: -3, z: 0 }, { x: 3, z: 0 }, 5)!;
    const samples = ellipseSamples(e, 0.3, 2.8, 10);
    const chain = arcChainFromSamples(samples, true, "funnel");
    // Sample the ideal curve far more finely than it was fitted, and ask the
    // chain where its surface is. Testing at the FIT points would only prove
    // the construction interpolates its own inputs.
    const fine = ellipseSamples(e, 0.35, 2.75, 400);
    let worst = 0;
    let covered = 0;
    for (const p of fine) {
      const n = nearestOnChain(chain, p.x, p.z);
      if (!n) continue;
      covered++;
      worst = Math.max(worst, n.gap);
    }
    expect(covered / fine.length).toBeGreaterThan(0.95);
    expect(worst).toBeLessThan(0.05);
  });

  it("drops a segment too flat to be a curve rather than emitting a vast circle", () => {
    // Two samples with all but parallel normals: the centre runs to infinity.
    const flat = [
      { x: 0, z: 0, nx: 0, nz: 1 },
      { x: 4, z: 0, nx: 1e-4, nz: 1 },
    ];
    for (const f of arcChainFromSamples(flat, true)) expect(f.r).toBeLessThanOrEqual(MAX_ARC_RADIUS);
  });

  it("reports no centre when the normals are parallel", () => {
    expect(normalIntersection({ x: 0, z: 0, nx: 0, nz: 1 }, { x: 4, z: 0, nx: 0, nz: 1 })).toBeNull();
  });
});

describe("the ellipse focuses — on the arc chain, not on the theorem", () => {
  it("a ray leaving one focus reflects through the other", () => {
    const f1: Pt = { x: -3, z: 0 };
    const f2: Pt = { x: 3, z: 0 };
    const e = ellipseFromFoci(f1, f2, 5)!;
    // The far half of the bowl — the stretch a relay chamber would build.
    const chain = arcChainFromSamples(ellipseSamples(e, 0.35, Math.PI - 0.35, 14), true, "funnel");

    let tested = 0;
    let worst = 0;
    for (let deg = 25; deg <= 155; deg += 5) {
      const th = (deg * Math.PI) / 180;
      const r = reflectOnce(chain, f1, { x: Math.cos(th), z: Math.sin(th) });
      if (!r) continue;
      tested++;
      worst = Math.max(worst, missDistance(r.hit, r.dir, f2));
    }
    expect(tested).toBeGreaterThan(20);
    // Under a ball radius: the reflected ray passes through the far focus by
    // any measure the game can resolve.
    expect(worst).toBeLessThan(0.3);
  });
});

describe("the parabola collects — every parallel ray lands on the mouth", () => {
  it("rays running down the corridor reflect into the doorway centre", () => {
    const focus: Pt = { x: 0, z: 0 };
    const axis: Pt = { x: 1, z: 0 }; // travel direction through the door
    const w = 3;
    const f = w / 4;
    const chain = arcChainFromSamples(parabolaSamples(focus, axis, f, 2 * f, 6, 12), true, "funnel");

    let tested = 0;
    let worst = 0;
    // Start well back up the corridor, spread across the catchment, all
    // travelling straight at the door — the case a corridor actually delivers.
    // The sweep stops at u = 4: past there the parabola's radius of curvature
    // exceeds MAX_ARC_RADIUS and the segments are deliberately dropped as a
    // straight taper, so there is no arc out there to reflect off. Sweeping
    // into that range would be testing the drop rule, not the focusing.
    for (let u = 1.6; u <= 4.0; u += 0.15) {
      const r = reflectOnce(chain, { x: -14, z: u }, { x: 1, z: 0 });
      if (!r) continue;
      tested++;
      worst = Math.max(worst, missDistance(r.hit, r.dir, focus));
    }
    expect(tested).toBeGreaterThan(15);
    expect(worst).toBeLessThan(0.3);
  });

  it("both jaws meet the jambs of the opening they feed, and flare from there", () => {
    const w = 5;
    const depth = 5;
    const { left, right } = parabolicJaws({ x: 0, z: 0 }, { x: 1, z: 0 }, w, depth);
    expect(left.length).toBeGreaterThan(2);
    expect(right.length).toBeGreaterThan(2);

    // The throat: at the threshold the arms sit exactly on the jambs, so the
    // funnel does NOT widen the opening the doorway vocabulary authored.
    const f = w / 4;
    const atThroat = parabolaSamples({ x: 0, z: 0 }, { x: 1, z: 0 }, f, 2 * f, 2 * f, 0)[0];
    expect(atThroat.x).toBeCloseTo(0, 9);
    expect(Math.abs(atThroat.z)).toBeCloseTo(w / 2, 9);

    // The catchment: much wider than the throat, which is the whole point.
    const uBack = Math.sqrt(4 * f * (f + depth));
    const atBack = parabolaSamples({ x: 0, z: 0 }, { x: 1, z: 0 }, f, uBack, uBack, 0)[0];
    expect(atBack.x).toBeCloseTo(-depth, 6);
    expect(Math.abs(atBack.z) / (w / 2)).toBeGreaterThan(1.4);
  });

  it("reports how far back the arcs actually reach, which is less than asked", () => {
    // The flat-tail rule (see `parabolicJaws`) means a caller that claims wall
    // out to `depth` would be claiming stone no arc is behind. `curvedDepth` is
    // the number to size the claim to, and it must never exceed the ask.
    for (const w of [3, 5, 7]) {
      const j = parabolicJaws({ x: 0, z: 0 }, { x: 1, z: 0 }, w, 12);
      expect(j.curvedDepth).toBeGreaterThan(0);
      // ≤, not <: with MAX_ARC_RADIUS raised for gentle throats the chain can
      // now reach the full depth it was asked for. What must never happen is
      // reaching FURTHER than asked, which is what a caller sizes its wall
      // claim against.
      expect(j.curvedDepth).toBeLessThanOrEqual(12 + 1e-9);
      // Every emitted arc is genuinely curved — nothing masquerading as a wall.
      for (const f of [...j.left, ...j.right]) expect(f.r).toBeLessThanOrEqual(MAX_ARC_RADIUS);
    }
  });

  it("a jaw never turns a forward-moving ball backwards — the funnel invariant", () => {
    // ── What this invariant is, and what it is NOT ────────────────────────
    //
    // The tempting statement is "no jaw surface faces back up the corridor",
    // and it is FALSE — necessarily so. Every converging wall leans against the
    // flow; that is what converging means. Asserting it fails at literally
    // every sample, which is how this test found its own first version.
    //
    // The true statement is about the REFLECTION, not the normal. In (s, u)
    // coordinates the jaw's inward normal is (−1, −k)/√(1+k²) with k = u/2f,
    // and a ball arriving straight down the corridor (v = +s) leaves along
    //
    //     v′·s = 1 − 2/(1 + k²)
    //
    // which is ≥ 0 exactly when k ≥ 1, i.e. |u| ≥ 2f — and |u| ≥ 2f is
    // precisely the jaw's domain, since 2f is where the arm meets the jamb.
    // The geometry is forward-only over exactly the stretch it is built on,
    // with equality (a graze) at the throat. That is not a tuning; it falls
    // out of tying f to the door width.
    //
    // It extends to any arrival that is CONVERGING on the axis: for those,
    // v′·s = [cos θ (k²−1) − 2k sin θ]/(1+k²) with sin θ opposing u, so both
    // terms are non-negative. A ball aimed at the door cannot be sent home.
    const axis: Pt = { x: 1, z: 0 };
    for (const w of [3, 5, 7]) {
      const { left, right } = parabolicJaws({ x: 0, z: 0 }, axis, w, 6);
      expect(left.length + right.length).toBeGreaterThan(3);
      for (const chain of [left, right]) {
        for (const arc of chain) {
          for (let s = 0; s <= 12; s++) {
            const ang = arc.a0 + (arc.span * s) / 12;
            const px = arc.cx + Math.cos(ang) * arc.r;
            const pz = arc.cz + Math.sin(ang) * arc.r;
            const n = nearestOnChain(chain, px, pz);
            expect(n).not.toBeNull();
            // Which side of the axis this sample is on decides which lateral
            // aim counts as "converging".
            const side = Math.sign(pz) || 1;
            for (const deg of [0, -10, -25, -45, -60]) {
              const th = (deg * side * Math.PI) / 180;
              const v = { x: Math.cos(th), z: Math.sin(th) };
              const vn = v.x * n!.nx + v.z * n!.nz;
              if (vn >= 0) continue; // not arriving into this face
              const out = { x: v.x - 2 * vn * n!.nx, z: v.z - 2 * vn * n!.nz };
              expect(out.x * axis.x + out.z * axis.z).toBeGreaterThan(-1e-6);
            }
          }
        }
      }
    }
  });
});

describe("degenerate input", () => {
  it("declines an ellipse that cannot contain its own foci", () => {
    expect(ellipseFromFoci({ x: -3, z: 0 }, { x: 3, z: 0 }, 2)).toBeNull();
    expect(ellipseFromFoci({ x: -3, z: 0 }, { x: 3, z: 0 }, 3)).toBeNull();
  });

  it("treats coincident foci as a circle rather than dividing by zero", () => {
    const e = ellipseFromFoci({ x: 1, z: 1 }, { x: 1, z: 1 }, 4)!;
    expect(e.a).toBeCloseTo(4, 9);
    expect(e.b).toBeCloseTo(4, 9);
    const chain = arcChainFromSamples(ellipseSamples(e, 0, Math.PI, 8), true);
    // Every link of a circle's fit is that circle.
    for (const f of chain) expect(f.r).toBeCloseTo(4, 4);
  });
});
