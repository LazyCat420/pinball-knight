/**
 * ARC SWEEPS — multi-tile curved walls: the math, the authoring invariants, and
 * the collider contract (a ball ricochets off a radius-3 sweep with a RADIAL,
 * varying normal and can never sink into it).
 */
import { describe, it, expect } from "vitest";
import { type Grid, T_FLOOR, T_WALL, at, isWalkable, idx, mulberry32, ensureArcs } from "./generator";
import { SHAPE_FULL, SHAPE_ARC, resolveArcFeature, angleInSpan, type ArcFeature } from "./tile-shape";
import { authorArcSweeps, stampOrbitIsland, ORBIT_RADIUS } from "./arc-sweeps";
import { moveCircle } from "../collision";
import { bfsDistances } from "../entities/ai";

const R2 = Math.SQRT1_2;

function emptyGrid(w: number, h: number, fill: number = T_WALL): Grid {
  return { w, h, t: new Uint8Array(w * h).fill(fill), shapes: new Uint8Array(w * h) };
}
function openRect(g: Grid, i0: number, j0: number, i1: number, j1: number): void {
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) g.t[j * g.w + i] = T_FLOOR;
}
function fullBfsOk(g: Grid, si: number, sj: number): boolean {
  const d = bfsDistances(g, si, sj);
  for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) if (isWalkable(g, i, j) && d[idx(g, i, j)] < 0) return false;
  return true;
}
const never = (): boolean => false;

describe("resolveArcFeature", () => {
  const convex: ArcFeature = { cx: 10, cz: 10, r: 3, a0: Math.PI, span: Math.PI / 2 }; // faces NW

  it("pushes radially out of a convex guide, with a normal that varies along the sweep", () => {
    // Approach along the NW diagonal (inside the span).
    const a = resolveArcFeature(convex, 10 - 2.3, 10 - 2.3, 0.3)!;
    expect(a).toBeTruthy();
    expect(a.nx).toBeCloseTo(-R2, 1);
    expect(a.nz).toBeCloseTo(-R2, 1);
    expect(a.pen).toBeCloseTo(3.3 - Math.hypot(2.3, 2.3), 5);
    // Approach nearly due west — different contact point, different normal.
    const b = resolveArcFeature(convex, 10 - 3.1, 10 - 0.4, 0.3)!;
    expect(b).toBeTruthy();
    expect(Math.abs(a.nx - b.nx)).toBeGreaterThan(0.1);
    expect(Math.hypot(b.nx, b.nz)).toBeCloseTo(1, 6);
  });

  it("returns null when clear, and outside the angular span (a flat wall's job)", () => {
    expect(resolveArcFeature(convex, 10 - 4, 10 - 4, 0.3)).toBeNull(); // beyond reach
    expect(resolveArcFeature(convex, 10 + 2.9, 10 + 0.5, 0.3)).toBeNull(); // SE side, off-span
  });

  it("concave bowl pushes back toward the centre", () => {
    const bowl: ArcFeature = { cx: 10, cz: 10, r: 3, a0: -Math.PI / 2, span: Math.PI / 2, solidOut: true };
    // Ball drifting into the NE rim from inside the bowl.
    const hit = resolveArcFeature(bowl, 10 + 2.0, 10 - 2.0, 0.3)!;
    expect(hit).toBeTruthy();
    expect(hit.nx).toBeCloseTo(-R2, 1); // pushed back toward C
    expect(hit.nz).toBeCloseTo(R2, 1);
    expect(resolveArcFeature(bowl, 10 + 1.5, 10 - 1.5, 0.3)).toBeNull(); // safely inside
  });

  it("full-circle span never gates", () => {
    expect(angleInSpan(1.234, 0, Math.PI * 2)).toBe(true);
    expect(angleInSpan(-2.9, 0.5, Math.PI * 2)).toBe(true);
  });
});

describe("authorArcSweeps", () => {
  /** 16×16: open floor with a solid 7×7 mass in the SE whose NW corner faces the room. */
  function convexSite(): Grid {
    const g = emptyGrid(16, 16);
    openRect(g, 1, 1, 14, 14);
    for (let j = 6; j <= 14; j++) for (let i = 6; i <= 14; i++) g.t[j * g.w + i] = T_WALL;
    return g;
  }

  it("authors a convex multi-tile sweep on a wall-mass corner", () => {
    const g = convexSite();
    const n = authorArcSweeps(g, { i: 2, j: 2 }, never, mulberry32(1));
    expect(n).toBeGreaterThan(0);
    // The room's border corners author concave sweeps too — pick the convex one.
    const f = g.arcs!.find((a) => !a.solidOut)!;
    expect(f).toBeTruthy();
    expect(f.r).toBeGreaterThanOrEqual(2);
    // The corner tile itself became an arc slice, still a wall for AI.
    expect(at(g, 6, 6)).toBe(T_WALL);
    expect(g.shapes[6 * g.w + 6]).toBe(SHAPE_ARC);
    expect(fullBfsOk(g, 2, 2)).toBe(true);
  });

  it("authors a concave sweep on a room inner corner and keeps the room connected", () => {
    const g = emptyGrid(16, 16);
    openRect(g, 2, 2, 11, 11); // room; inner corners at the 4 extremes
    const before = at(g, 11, 2);
    expect(before).toBe(T_FLOOR);
    const n = authorArcSweeps(g, { i: 3, j: 6 }, never, mulberry32(1));
    expect(n).toBeGreaterThan(0);
    const concave = g.arcs!.filter((f) => f.solidOut);
    expect(concave.length).toBeGreaterThan(0);
    // Some corner floor became curved wall; everything left stays reachable.
    let arcTiles = 0;
    for (let k = 0; k < g.shapes.length; k++) if (g.shapes[k] === SHAPE_ARC) arcTiles++;
    expect(arcTiles).toBeGreaterThan(0);
    expect(fullBfsOk(g, 3, 6)).toBe(true);
  });

  it("respects occupied tiles for the wall-adding family", () => {
    const g = emptyGrid(16, 16);
    openRect(g, 2, 2, 11, 11);
    const every = (): boolean => true; // everything is protected content
    authorArcSweeps(g, { i: 3, j: 6 }, every, mulberry32(1));
    expect((g.arcs ?? []).filter((f) => f.solidOut).length).toBe(0);
  });
});

describe("moveCircle vs a multi-tile sweep", () => {
  function sweepGrid(): { g: Grid; f: import("./tile-shape").ArcFeature; C: { x: number; z: number } } {
    const g = emptyGrid(16, 16);
    openRect(g, 1, 1, 14, 14);
    for (let j = 6; j <= 14; j++) for (let i = 6; i <= 14; i++) g.t[j * g.w + i] = T_WALL;
    authorArcSweeps(g, { i: 2, j: 2 }, never, mulberry32(1));
    const f = g.arcs!.find((a) => !a.solidOut)!;
    return { g, f, C: { x: f.cx, z: f.cz } };
  }

  it("blocks the ball at the arc with a radial hitN and never lets it sink in", () => {
    const { g, f, C } = sweepGrid();
    // World = grid − w/2. Drive the ball along the NW diagonal into the arc.
    const toWorld = (gx: number, gz: number): [number, number] => [gx - g.w / 2, gz - g.h / 2];
    const [sx, sz] = toWorld(C.x - 4.2, C.z - 4.2);
    let pos = { x: sx, z: sz, hitN: null as { nx: number; nz: number } | null };
    let lastHit: { nx: number; nz: number } | null = null;
    for (let step = 0; step < 30; step++) {
      pos = moveCircle(g, pos.x, pos.z, 0.3, 0.18, 0.18);
      if (pos.hitN) lastHit = pos.hitN;
    }
    expect(lastHit).toBeTruthy();
    // Radial normal ≈ NW diagonal, and the ball rests outside the arc.
    expect(lastHit!.nx).toBeLessThan(-0.5);
    expect(lastHit!.nz).toBeLessThan(-0.5);
    const gx = pos.x + g.w / 2;
    const gz = pos.z + g.h / 2;
    expect(Math.hypot(gx - C.x, gz - C.z)).toBeGreaterThanOrEqual(f.r + 0.3 - 0.02);
  });

  it("the contact normal varies along the sweep (curved ricochet, not a flat face)", () => {
    const { g, C } = sweepGrid();
    // FIRST contact normal: after that the ball slides around the curve and
    // every probe's normal converges — which is precisely the sweep working.
    const probe = (gx0: number, gz0: number, dx: number, dz: number): { nx: number; nz: number } | null => {
      let p = { x: gx0 - g.w / 2, z: gz0 - g.h / 2, hitN: null as { nx: number; nz: number } | null };
      for (let s = 0; s < 40; s++) {
        p = moveCircle(g, p.x, p.z, 0.3, dx, dz);
        if (p.hitN) return p.hitN;
      }
      return null;
    };
    const diag = probe(C.x - 4.2, C.z - 4.2, 0.15, 0.15);
    const west = probe(C.x - 4.2, C.z - 0.8, 0.15, 0);
    expect(diag).toBeTruthy();
    expect(west).toBeTruthy();
    expect(Math.abs(diag!.nx - west!.nx) + Math.abs(diag!.nz - west!.nz)).toBeGreaterThan(0.2);
  });
});

describe("stampOrbitIsland", () => {
  it("stamps a round island with a clear ring and full connectivity", () => {
    const g = emptyGrid(24, 24);
    openRect(g, 1, 1, 22, 22);
    const site = stampOrbitIsland(g, { i: 2, j: 2 }, never, mulberry32(7));
    expect(site).toBeTruthy();
    const f = g.arcs![g.arcs!.length - 1];
    expect(f.span).toBeCloseTo(Math.PI * 2, 6);
    expect(f.r).toBe(ORBIT_RADIUS);
    // Island core is wall; the ring one tile beyond the rim is walkable.
    expect(at(g, Math.round(f.cx), Math.round(f.cz))).toBe(T_WALL);
    const ringD = f.r + 0.8;
    for (const a of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      const ti = Math.floor(f.cx + Math.cos(a) * ringD);
      const tj = Math.floor(f.cz + Math.sin(a) * ringD);
      expect(isWalkable(g, ti, tj)).toBe(true);
    }
    expect(fullBfsOk(g, 2, 2)).toBe(true);
  });

  it("declines when there is no open disc", () => {
    const g = emptyGrid(24, 24);
    openRect(g, 1, 1, 22, 4); // a thin corridor only
    expect(stampOrbitIsland(g, { i: 2, j: 2 }, never, mulberry32(7))).toBeNull();
  });
});

describe("arc bookkeeping", () => {
  it("ensureArcs is idempotent and arc slices always index a real feature", () => {
    const g = emptyGrid(16, 16);
    openRect(g, 1, 1, 14, 14);
    for (let j = 6; j <= 14; j++) for (let i = 6; i <= 14; i++) g.t[j * g.w + i] = T_WALL;
    ensureArcs(g);
    ensureArcs(g);
    authorArcSweeps(g, { i: 2, j: 2 }, never, mulberry32(3));
    for (let k = 0; k < g.shapes.length; k++) {
      if (g.shapes[k] === SHAPE_ARC) {
        const fid = g.arcIdx![k];
        expect(fid).toBeGreaterThanOrEqual(0);
        expect(g.arcs![fid]).toBeTruthy();
      } else {
        expect(g.arcIdx![k]).toBe(-1);
      }
    }
    // No non-arc tile carries SHAPE_ARC leakage into the r=1 families.
    for (let k = 0; k < g.shapes.length; k++) {
      if (g.arcIdx![k] >= 0) expect(g.shapes[k]).toBe(SHAPE_ARC);
    }
  });
});
