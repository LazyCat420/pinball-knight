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
import { type Grid, isWalkable, shapeAt, arcFeatureAt, idx } from "./grid";
import { clamp } from "../../../utils/math";
import {
  SHAPE_FULL,
  isShaped,
  isArc,
  resolveCircleShape,
  resolveArcFeature,
  kickBandAt,
  laneBandAt,
  laneTangent,
  type KickBand,
  type LaneBand,
} from "./tile-shape";

const EPS = 1e-4;

/** A booster-lane contact: the band that owns it plus its exit TANGENT, both
 *  computed off the arc that answered so the launch follows the visible wall. */
export interface LaneHit {
  band: LaneBand;
  tx: number;
  tz: number;
  /**
   * Which ArcFeature this contact belongs to. The RAIL needs it to know it is
   * still on the SAME curve frame to frame — without an identity a ball
   * brushing two different sweeps in quick succession would read as one
   * continuous ride and keep its accumulated overspeed across a gap it never
   * actually carried it through.
   */
  featureIdx: number;
  /**
   * True when this face is CONCAVE (solid outside the circle) — the inside of
   * a bend, the banked racing line. Only these can be railed: on a convex
   * bulge there is nothing to lean into, the wall curves away from you.
   */
  concave: boolean;
}

/**
 * Does a solid tile block the axis-separated square sweep? A shaped (slant) tile
 * is TRANSPARENT to the sweep — its diagonal is owned solely by resolveShaped,
 * so the square clamp must not stop the circle at the cell boundary (or the
 * diagonal would never be felt). Its two legs still block, but via the solid
 * SQUARE neighbours that back them (see tile-shape.ts SLANT_BACKING).
 */
function blocksSquare(g: Grid, i: number, j: number): boolean {
  return !isWalkable(g, i, j) && shapeAt(g, i, j) === SHAPE_FULL;
}

/**
 * Resolve a circle against ONE shaped tile, whatever family it is: slants and
 * single-tile rounds carry their geometry in the shape id; an ARC slice defers
 * to its multi-tile feature. Every arc slice of one feature resolves against
 * the SAME circle, so overlapping two slices at once yields one consistent
 * radial answer — "deepest pen wins" stays coherent across the sweep.
 */
function resolveShapeOrArc(
  g: Grid,
  shape: number,
  i: number,
  j: number,
  gx: number,
  gz: number,
  r: number,
  mx: number,
  mz: number,
): { nx: number; nz: number; pen: number; kick?: KickBand | null; lane?: LaneHit | null } | null {
  if (isArc(shape)) {
    const f = arcFeatureAt(g, i, j);
    if (!f) return null;
    const hit = resolveArcFeature(f, gx, gz, r);
    if (!hit) return null;
    // A sweep can wear BOOSTER RUBBER over part of its face (KickBand), or be a
    // BOOSTER LANE that carries the ball along it (LaneBand). Both are resolved
    // here rather than in the caller because only this scope still knows WHICH
    // feature answered. A lane also needs the travel direction, hence mx/mz:
    // it only grabs a ball already moving along its grain.
    const lane = laneBandAt(f, gx, gz, mx, mz);
    return {
      ...hit,
      kick: kickBandAt(f, gx, gz),
      lane: lane
        ? {
            band: lane,
            ...laneTangent(f, lane, gx, gz),
            featureIdx: g.arcIdx ? g.arcIdx[idx(g, i, j)] : -1,
            // solidOut = solid OUTSIDE the circle = the ball rides the inside
            // = a banked face you can lean into. That is the rail surface.
            concave: !!f.solidOut,
          }
        : null,
    };
  }
  return resolveCircleShape(shape, i, j, gx, gz, r);
}

/** True if a circle at world (x, z) with radius r overlaps any solid tile
 * (shape-aware: a slant tile is tested against its triangle, not its square). */
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
      const shape = shapeAt(g, i, j);
      if (isShaped(shape)) {
        // A static overlap test has no travel direction, so pass a zero vector:
        // no lane can claim the contact (laneBandAt needs positive travel along
        // the grain), which is right — this asks "am I inside a wall", and a
        // booster lane is a wall either way.
        if (resolveShapeOrArc(g, shape, i, j, gx, gz, r, 0, 0)) return true;
        continue;
      }
      // Closest point on the tile AABB to the circle centre.
      const cx = clamp(gx, i, i + 1);
      const cz = clamp(gz, j, j + 1);
      const dx = gx - cx;
      const dz = gz - cz;
      if (dx * dx + dz * dz < r * r) return true;
    }
  }
  return false;
}

/**
 * Which wall the circle is pressed against, and the direction to launch OFF it.
 *
 * Probes the four cardinal offsets a hair (`probe`) beyond the body radius: any
 * that would overlap a solid tile is a touching wall. Returns the summed
 * outward NORMAL (unit-ish, pointing AWAY from the wall — where a wall-kick
 * hurls you), or null if the circle is in open floor. Feeds the wall-move
 * system in player.ts; deliberately grid-only so it stays DOM/three-free and
 * testable like the rest of collision.ts.
 */
export function wallContact(
  g: Grid,
  x: number,
  z: number,
  r: number,
  probe: number,
): { nx: number; nz: number } | null {
  // A tiny probe circle sitting just past the body's leading edge on each
  // cardinal: it overlaps a wall only when the body is (almost) touching it.
  const edge = r + probe;
  const pr = probe;
  let nx = 0;
  let nz = 0;
  // East wall pushes you west, etc. A corner sums two normals into a diagonal.
  if (circleCollides(g, x + edge, z, pr)) nx -= 1; // wall to the east → launch west
  if (circleCollides(g, x - edge, z, pr)) nx += 1; // wall to the west → launch east
  if (circleCollides(g, x, z + edge, pr)) nz -= 1; // wall to the south → launch north
  if (circleCollides(g, x, z - edge, pr)) nz += 1; // wall to the north → launch south
  if (nx === 0 && nz === 0) return null;
  const len = Math.hypot(nx, nz) || 1;
  return { nx: nx / len, nz: nz / len };
}

/**
 * CURVED WALLS — a banked corner arc auto-derived from maze topology.
 *
 * A grid this tight (player diameter 0.6 vs 1-tile cells) can't host a real
 * circle-vs-arc SOLID without sealing 1-wide bends, so — exactly like the
 * shipped deflector part — a curved corner is a POINT-TRIGGER momentum BANK
 * plus a rendered quarter-cylinder wedge (maze/build.ts), not a new collider.
 * The win over the deflector: these are detected on EVERY qualifying corner,
 * so the whole maze banks, not just the handful of tiles a part landed on.
 *
 * `d1/d2` are the corner's two OPEN legs (a fast entry along one exits along
 * the other, speed intact); `qi/qj` mark WHICH of the tile's four corners the
 * wedge caps (0 or 1 on each axis, for the renderer). `cooldownT`/`hitT` are
 * mutable per-frame scratch, reset when the arc list is rebuilt each level.
 */
export interface ArcCorner {
  cx: number;
  cz: number; // world centre of the crook tile
  d1x: number;
  d1z: number;
  d2x: number;
  d2z: number;
  qi: number; // 0 → west edge, 1 → east edge of the tile
  qj: number; // 0 → north edge, 1 → south edge of the tile
  cooldownT: number;
  hitT: number;
}

/**
 * Every maze corner that reads as a banked curve: a floor tile with two
 * PERPENDICULAR wall neighbours (a solid diagonal between them) whose two
 * OPEN sides — and the far diagonal — are floor, i.e. it sits on the inner
 * corner of a ≥2×2 open pocket. The open-neighbour + far-diagonal gate is
 * what excludes 1-wide dogleg bends (whose far diagonal is wall), so a curve
 * only lands where there's room to sweep and never pinches a corridor.
 */
export function computeArcCorners(g: Grid): ArcCorner[] {
  const out: ArcCorner[] = [];
  const ox = g.w / 2;
  const oz = g.h / 2;
  const floor = (i: number, j: number): boolean => isWalkable(g, i, j);
  const wall = (i: number, j: number): boolean => !isWalkable(g, i, j);
  // Per crook: two wall dirs, the solid diagonal, the two open legs, the far
  // (open) diagonal, and which tile corner the wedge caps.
  const crooks = [
    { wa: [0, -1], wb: [1, 0], diag: [1, -1], opp: [-1, 1], l1: [-1, 0], l2: [0, 1], qi: 1, qj: 0 }, // NE
    { wa: [0, -1], wb: [-1, 0], diag: [-1, -1], opp: [1, 1], l1: [1, 0], l2: [0, 1], qi: 0, qj: 0 }, // NW
    { wa: [0, 1], wb: [1, 0], diag: [1, 1], opp: [-1, -1], l1: [-1, 0], l2: [0, -1], qi: 1, qj: 1 }, // SE
    { wa: [0, 1], wb: [-1, 0], diag: [-1, 1], opp: [1, -1], l1: [1, 0], l2: [0, -1], qi: 0, qj: 1 }, // SW
  ] as const;
  for (let j = 1; j < g.h - 1; j++) {
    for (let i = 1; i < g.w - 1; i++) {
      if (!floor(i, j)) continue;
      for (const c of crooks) {
        if (
          wall(i + c.wa[0], j + c.wa[1]) &&
          wall(i + c.wb[0], j + c.wb[1]) &&
          wall(i + c.diag[0], j + c.diag[1]) &&
          floor(i + c.l1[0], j + c.l1[1]) &&
          floor(i + c.l2[0], j + c.l2[1]) &&
          floor(i + c.opp[0], j + c.opp[1])
        ) {
          out.push({
            cx: i + 0.5 - ox,
            cz: j + 0.5 - oz,
            d1x: c.l1[0],
            d1z: c.l1[1],
            d2x: c.l2[0],
            d2z: c.l2[1],
            qi: c.qi,
            qj: c.qj,
            cooldownT: 0,
            hitT: -1,
          });
        }
      }
    }
  }
  return out;
}

/** The resolved position, plus the contact NORMAL if a SHAPED (slant) wall was
 * hit this move — the pinball reflection reads `hitN` for a diagonal ricochet;
 * every other caller ignores it and just takes {x,z}. */
export interface MoveResult {
  x: number;
  z: number;
  hitN: { nx: number; nz: number } | null;
  /** The BOOSTER band that owned the contact, when `hitN` came off a stretch of
   * kicker rubber on an arc sweep — the ricochet becomes a kick (player.ts).
   * null for plain stone; ignored by every non-pinball caller. */
  hitKick: KickBand | null;
  /** The BOOSTER LANE that owned the contact, when `hitN` came off a curved
   * speed strip the ball is running WITH — the ricochet becomes a tangential
   * launch along the bend instead (player.ts). Mutually exclusive with hitKick
   * in practice, since arc-sweeps authors one or the other per stretch. */
  hitLane: LaneHit | null;
}

/**
 * Push a circle (grid-space centre) out of every SHAPED tile it overlaps, and
 * return the deepest contact normal. The square sweep leaves shaped tiles
 * alone (they're transparent to it), so this is their sole collider. Slants are
 * placed only on backed convex corners (see assignCornerShapes), so a body this
 * size overlaps at most one meaningfully — resolving the deepest is enough.
 */
function resolveShaped(
  g: Grid,
  gx: number,
  gz: number,
  r: number,
  mx: number,
  mz: number,
): { gx: number; gz: number; nx: number; nz: number; kick: KickBand | null; lane: LaneHit | null } | null {
  const i0 = Math.floor(gx - r);
  const i1 = Math.floor(gx + r);
  const j0 = Math.floor(gz - r);
  const j1 = Math.floor(gz + r);
  let best: { pen: number; nx: number; nz: number; kick: KickBand | null; lane: LaneHit | null } | null = null;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const shape = shapeAt(g, i, j);
      if (!isShaped(shape) || isWalkable(g, i, j)) continue;
      const hit = resolveShapeOrArc(g, shape, i, j, gx, gz, r, mx, mz);
      if (hit && (!best || hit.pen > best.pen)) best = { pen: hit.pen, nx: hit.nx, nz: hit.nz, kick: hit.kick ?? null, lane: hit.lane ?? null };
    }
  }
  if (!best) return null;
  return { gx: gx + best.nx * (best.pen + EPS), gz: gz + best.nz * (best.pen + EPS), nx: best.nx, nz: best.nz, kick: best.kick, lane: best.lane };
}

/** One sweep-and-clamp move (square walls) + one corrective shaped pass. Grid
 * coords in/out. Sub-stepping in `moveCircle` keeps each call within the
 * no-tunnel bound. */
function moveCircleStep(
  g: Grid,
  gx0: number,
  gz0: number,
  r: number,
  dx: number,
  dz: number,
): { gx: number; gz: number; hitN: { nx: number; nz: number } | null; hitKick: KickBand | null; hitLane: LaneHit | null } {
  let gx = gx0;

  // ── X axis (square walls only; slant tiles are transparent here) ──
  if (dx !== 0) {
    gx += dx;
    const dir = Math.sign(dx);
    const lead = dir > 0 ? gx + r : gx - r; // the circle's leading edge
    const ti = Math.floor(lead);
    const j0 = Math.floor(gz0 - r + EPS);
    const j1 = Math.floor(gz0 + r - EPS);
    for (let j = j0; j <= j1; j++) {
      if (blocksSquare(g, ti, j)) {
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
      if (blocksSquare(g, i, tj)) {
        gz = dir > 0 ? tj - r - EPS : tj + 1 + r + EPS;
        break;
      }
    }
  }

  // ── Corrective pass: push out of any slant triangle, capture its normal. ──
  // The requested move (dx,dz) IS the travel direction at contact, which is what
  // a booster lane needs to decide whether the ball is running with its grain.
  const shaped = resolveShaped(g, gx, gz, r, dx, dz);
  if (shaped) return { gx: shaped.gx, gz: shaped.gz, hitN: { nx: shaped.nx, nz: shaped.nz }, hitKick: shaped.kick, hitLane: shaped.lane };
  return { gx, gz, hitN: null, hitKick: null, hitLane: null };
}

/** Largest per-step move that keeps the axis sweep tunnel-free (< 1 − 2r). */
const MAX_STEP = 0.4;

/**
 * Move a circle by (dx, dz), clamping against walls (square tiles) and slants
 * (shaped tiles). Returns the resolved world position and, if a slant face was
 * struck, its contact normal (`hitN`) for a diagonal ricochet.
 *
 * Sub-steps when the requested move exceeds the no-tunnel bound (the pinball at
 * terminal speed does ~0.5 units/frame, over the old |d| < 1−2r ≈ 0.4 limit),
 * so both the square sweep and the slant pass stay correct at any speed.
 */
export function moveCircle(g: Grid, x: number, z: number, r: number, dx: number, dz: number): MoveResult {
  let gx = x + g.w / 2;
  let gz = z + g.h / 2;
  const dist = Math.hypot(dx, dz);
  const steps = dist > MAX_STEP ? Math.ceil(dist / MAX_STEP) : 1;
  const sx = dx / steps;
  const sz = dz / steps;
  let hitN: { nx: number; nz: number } | null = null;
  let hitKick: KickBand | null = null;
  let hitLane: LaneHit | null = null;
  for (let s = 0; s < steps; s++) {
    const r2 = moveCircleStep(g, gx, gz, r, sx, sz);
    gx = r2.gx;
    gz = r2.gz;
    if (r2.hitN) {
      hitN = r2.hitN; // keep the most recent slant contact…
      hitKick = r2.hitKick; // …and the rubber (or lack of it) that went with it
      hitLane = r2.hitLane; // …and the lane, likewise
    }
  }
  return { x: gx - g.w / 2, z: gz - g.h / 2, hitN, hitKick, hitLane };
}
