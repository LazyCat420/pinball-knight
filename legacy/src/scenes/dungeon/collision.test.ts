import { describe, it, expect } from "vitest";
import { type Grid, T_FLOOR, T_WALL, tileCenter } from "./maze/generator";
import { circleCollides, moveCircle, wallContact } from "./collision";

/** A 7x5 room: solid border, open interior, one pillar at (3,2). */
function room(): Grid {
  const w = 7;
  const h = 5;
  const t = new Uint8Array(w * h).fill(T_WALL);
  for (let j = 1; j < h - 1; j++) {
    for (let i = 1; i < w - 1; i++) t[j * w + i] = T_FLOOR;
  }
  t[2 * w + 3] = T_WALL; // pillar
  return { w, h, t };
}

const R = 0.3;

describe("collision", () => {
  it("detects overlap with walls and clear space", () => {
    const g = room();
    const open = tileCenter(g, 1, 1);
    expect(circleCollides(g, open.x, open.z, R)).toBe(false);
    const pillar = tileCenter(g, 3, 2);
    expect(circleCollides(g, pillar.x, pillar.z, R)).toBe(true);
  });

  it("cannot walk through a wall", () => {
    const g = room();
    const start = tileCenter(g, 1, 2); // pillar is two tiles east at (3,2)
    let pos = { x: start.x, z: start.z };
    for (let i = 0; i < 100; i++) pos = moveCircle(g, pos.x, pos.z, R, 0.05, 0);
    // Stopped at the pillar's west face: circle centre ≤ tile edge - r.
    const pillarWestEdge = 3 - g.w / 2;
    expect(pos.x).toBeLessThanOrEqual(pillarWestEdge - R + 1e-3);
    expect(circleCollides(g, pos.x, pos.z, R)).toBe(false);
  });

  it("slides along a wall on diagonal input", () => {
    const g = room();
    const start = tileCenter(g, 2, 1); // against the north border wall
    let pos = { x: start.x, z: start.z };
    const before = pos.x;
    for (let i = 0; i < 40; i++) pos = moveCircle(g, pos.x, pos.z, R, 0.05, -0.05);
    expect(pos.x).toBeGreaterThan(before + 1); // kept moving east...
    expect(pos.z).toBeCloseTo(start.z, 0); // ...while the wall held north
    expect(circleCollides(g, pos.x, pos.z, R)).toBe(false);
  });

  it("a zero move is a no-op", () => {
    const g = room();
    const p = tileCenter(g, 1, 1);
    expect(moveCircle(g, p.x, p.z, R, 0, 0)).toEqual({ x: p.x, z: p.z });
  });
});

describe("wallContact (wall-move detection)", () => {
  const PROBE = 0.14;

  it("returns null in open floor", () => {
    const g = room();
    const open = tileCenter(g, 3, 3); // interior, no adjacent wall within a body+probe
    // (3,3) sits one tile from every border in this 7x5 room's interior band.
    expect(wallContact(g, open.x, open.z, R, PROBE)).toBeNull();
  });

  it("points AWAY from a single wall the body is pressed against", () => {
    const g = room();
    // Slide east into the pillar's west face at (3,2), then probe.
    const start = tileCenter(g, 1, 2);
    let pos = { x: start.x, z: start.z };
    for (let i = 0; i < 100; i++) pos = moveCircle(g, pos.x, pos.z, R, 0.05, 0);
    const n = wallContact(g, pos.x, pos.z, R, PROBE);
    expect(n).not.toBeNull();
    expect(n!.nx).toBeLessThan(0); // wall is to the EAST → launch WEST (−x)
    expect(Math.abs(n!.nz)).toBeLessThan(0.01); // no north/south component
    expect(Math.hypot(n!.nx, n!.nz)).toBeCloseTo(1, 5); // unit normal
  });

  it("sums two faces into a diagonal in a corner", () => {
    const g = room();
    // Drive into the NW corner (north + west border walls both adjacent).
    const start = tileCenter(g, 3, 3);
    let pos = { x: start.x, z: start.z };
    for (let i = 0; i < 100; i++) pos = moveCircle(g, pos.x, pos.z, R, -0.05, -0.05);
    const n = wallContact(g, pos.x, pos.z, R, PROBE);
    expect(n).not.toBeNull();
    expect(n!.nx).toBeGreaterThan(0); // west wall → launch east (+x)
    expect(n!.nz).toBeGreaterThan(0); // north wall → launch south (+z)
    expect(Math.hypot(n!.nx, n!.nz)).toBeCloseTo(1, 5); // still normalised
  });
});
