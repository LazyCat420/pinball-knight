/**
 * Circle-vs-tile-grid collision. No physics engine — a top-down grid maze
 * needs axis-separated sweep-and-clamp, which is deterministic, debuggable and
 * ~60 lines (see BLUEPRINT §1.5 for why Rapier/cannon-es stay on the shelf).
 *
 * Movement is resolved one axis at a time: try the X move, clamp against any
 * wall the circle would enter, then the same for Z. Clamping only the moved
 * axis is what produces wall SLIDING for free — pressing diagonally into a
 * wall glides you along it instead of sticking.
 *
 * Coordinates are world coords (maze centred on origin, 1 tile = 1 unit).
 * DOM- and three-free: tested.
 */
import { type Grid, isWalkable } from "./maze/generator";

const EPS = 1e-4;

/** True if a circle at world (x, z) with radius r overlaps any solid tile. */
export function circleCollides(g: Grid, x: number, z: number, r: number): boolean {
  const gx = x + g.w / 2;
  const gz = z + g.h / 2;
  const i0 = Math.floor(gx - r);
  const i1 = Math.floor(gx + r);
  const j0 = Math.floor(gz - r);
  const j1 = Math.floor(gz + r);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      if (isWalkable(g, i, j)) continue;
      // Closest point on the tile AABB to the circle centre.
      const cx = Math.max(i, Math.min(gx, i + 1));
      const cz = Math.max(j, Math.min(gz, j + 1));
      const dx = gx - cx;
      const dz = gz - cz;
      if (dx * dx + dz * dz < r * r) return true;
    }
  }
  return false;
}

/**
 * Move a circle by (dx, dz), clamping against walls. Returns the resolved
 * world position. Assumes |dx|,|dz| < 1 - 2r per call (true at our speeds and
 * frame times by an order of magnitude), so no tunnelling checks needed.
 */
export function moveCircle(
  g: Grid,
  x: number,
  z: number,
  r: number,
  dx: number,
  dz: number,
): { x: number; z: number } {
  let gx = x + g.w / 2;
  const gz0 = z + g.h / 2;

  // ── X axis ──
  if (dx !== 0) {
    gx += dx;
    const dir = Math.sign(dx);
    const lead = dir > 0 ? gx + r : gx - r; // the circle's leading edge
    const ti = Math.floor(lead);
    const j0 = Math.floor(gz0 - r + EPS);
    const j1 = Math.floor(gz0 + r - EPS);
    for (let j = j0; j <= j1; j++) {
      if (!isWalkable(g, ti, j)) {
        gx = dir > 0 ? ti - r - EPS : ti + 1 + r + EPS;
        break;
      }
    }
  }

  // ── Z axis (against the already-resolved X) ──
  let gz = gz0;
  if (dz !== 0) {
    gz += dz;
    const dir = Math.sign(dz);
    const lead = dir > 0 ? gz + r : gz - r;
    const tj = Math.floor(lead);
    const i0 = Math.floor(gx - r + EPS);
    const i1 = Math.floor(gx + r - EPS);
    for (let i = i0; i <= i1; i++) {
      if (!isWalkable(g, i, tj)) {
        gz = dir > 0 ? tj - r - EPS : tj + 1 + r + EPS;
        break;
      }
    }
  }

  return { x: gx - g.w / 2, z: gz - g.h / 2 };
}
