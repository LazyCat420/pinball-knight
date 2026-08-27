/**
 * TRACK CARVE — burn the circuit into tiles, then grow the maze around it.
 *
 * This is the module that actually inverts the pipeline. The shipped order is
 *
 *     generateMaze → … → widenMainArtery      (track derived FROM the maze)
 *
 * and here it becomes
 *
 *     growTrack → buildTrackPath → carveTrack → growMazeAround
 *                                  ^^^^^^^^^^   ^^^^^^^^^^^^^^
 *                                  this file
 *
 * The track claims its tiles FIRST, at whatever width and corner radius the
 * geometry asked for, and the maze is then grown into what's left over — never
 * through the circuit. That is why the curves can be radius 5-7 here when the
 * shipped scavenger managed radius 4 exactly four times in forty floors: we are
 * allocating space rather than hunting for it.
 *
 * ── Connectivity is the hard constraint ───────────────────────────────────
 *
 * `floor-pipeline.test.ts` asserts every floor is solvable start→stairs, and a
 * player stranded on a floor is the worst bug this generator can ship. Two
 * properties keep that safe here, and both are structural rather than checked
 * after the fact:
 *
 *  1. The track is ONE connected component by construction — `pruneToCircuit`
 *     guarantees the graph is connected, and carving a connected set of legs
 *     and fillets yields a connected floor region.
 *  2. Maze growth only ever carves wall→floor, which can only ADD connectivity,
 *     and every maze cell is grown FROM a tile adjacent to already-open space.
 *     So everything the maze opens is reachable from the track.
 *
 * DOM- and three-free.
 */
import {
  type Grid,
  type TilePos,
  T_WALL,
  T_FLOOR,
  at,
  idx,
  setTile,
  setShape,
  ensureArcs,
  isWalkable,
  shapeAt,
} from "./generator";
import { SHAPE_FULL, SHAPE_ARC } from "../engine/tile-shape";
import type { TrackPath } from "./track-path";

/** Marks which tiles belong to the circuit, so later passes can respect it. */
export interface TrackMask {
  /** 1 = carved as track surface. Row-major, same layout as Grid.t. */
  lane: Uint8Array;
  /** Distance in tiles from the track centreline (Infinity off-track). */
  dist: Float32Array;
  /**
   * 1 = lane tile that must stay SEALED — no on-ramp may open into it and no
   * connectivity repair may tunnel through its wall.
   *
   * Today that is exactly the launch chute (track-launch.ts). A plunger lane
   * whose sides the on-ramp pass has drilled is not a plunger lane: the launch
   * dribbles out of a side door instead of committing down the hallway. This
   * lives on the MASK rather than as a list of tiles the chute module keeps,
   * for the same reason `socketAt` derives its labels from the grid — a
   * parallel structure is a structure that can drift.
   */
  sealed: Uint8Array;
}

/** Is this lane tile one nothing may tap into? Bounds-safe, like `onLane`. */
function isSealed(g: Grid, mask: TrackMask, i: number, j: number): boolean {
  if (i < 0 || j < 0 || i >= g.w || j >= g.h) return false;
  return mask.sealed[idx(g, i, j)] === 1;
}

/**
 * Wall tiles pressed against a SEALED lane — the keep-out for `connectAll`.
 *
 * Derived on demand from the mask rather than handed around, so it is always
 * in step with whatever is currently sealed.
 */
export function sealedWalls(g: Grid, mask: TrackMask): Uint8Array {
  const out = new Uint8Array(g.w * g.h);
  for (let j = 1; j < g.h - 1; j++) {
    for (let i = 1; i < g.w - 1; i++) {
      if (isWalkable(g, i, j)) continue;
      // Two tiles deep: a repair corridor that merely clips the outer column
      // still leaves a one-tile membrane, and `removeWallStubs` deletes those.
      for (let dj = -2; dj <= 2; dj++) {
        for (let di = -2; di <= 2; di++) {
          if (isSealed(g, mask, i + di, j + dj)) {
            out[idx(g, i, j)] = 1;
            di = 3;
            dj = 3;
          }
        }
      }
    }
  }
  return out;
}

/**
 * Bounds-safe mask read. `idx` does no range check (it is on the hot path for
 * every tile loop in the game), so an out-of-bounds probe yields a nonsense
 * offset — and on the grid EDGE that reads as `undefined`, which is falsy and
 * therefore silently wrong rather than loud. Off-grid is never track.
 */
function onLane(g: Grid, mask: TrackMask, i: number, j: number): boolean {
  if (i < 0 || j < 0 || i >= g.w || j >= g.h) return false;
  return mask.lane[idx(g, i, j)] === 1;
}

/** Stamp a filled disc of floor — the brush every carve stroke uses. */
function disc(g: Grid, mask: TrackMask, cx: number, cz: number, r: number): void {
  const i0 = Math.max(1, Math.floor(cx - r));
  const i1 = Math.min(g.w - 2, Math.ceil(cx + r));
  const j0 = Math.max(1, Math.floor(cz - r));
  const j1 = Math.min(g.h - 2, Math.ceil(cz + r));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const dx = i + 0.5 - cx;
      const dz = j + 0.5 - cz;
      const d = Math.hypot(dx, dz);
      if (d > r) continue;
      const k = idx(g, i, j);
      setTile(g, i, j, T_FLOOR);
      setShape(g, i, j, SHAPE_FULL);
      mask.lane[k] = 1;
      if (d < mask.dist[k]) mask.dist[k] = d;
    }
  }
}

/**
 * Sweep the disc brush along a straight segment — one carve STROKE.
 *
 * Exported because the launch chute (track-launch.ts) is carved with the same
 * brush as the circuit itself, deliberately: the chute must be a lane in every
 * sense the rest of the pipeline understands (mask, keep-out margin, dead-end
 * exemption, socket type), not a corridor that merely looks like one. Sharing
 * the brush is what makes that true by construction rather than by remembering.
 */
export function carveStroke(g: Grid, mask: TrackMask, x0: number, z0: number, x1: number, z1: number, half: number): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const steps = Math.max(1, Math.ceil(len / 0.35));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    disc(g, mask, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, half);
  }
}

/**
 * Carve the circuit into the grid.
 *
 * Legs are swept discs along the segment; fillets are swept discs along the
 * arc. Sweeping a disc (rather than filling a polygon) is what makes the lane
 * width and the corner radius independent — the ARC is the centreline and the
 * brush gives it thickness, so a radius-6 fillet carved with a 2.5-wide brush
 * is a genuine banked turn with an inner and outer wall, not a wedge.
 *
 * The step is deliberately fine (0.35 tiles). A coarse step leaves scalloped
 * edges along diagonals, and scallops are exactly the "why does this wall have
 * a notch in it" artefact that makes generated geometry look accidental.
 */
export function carveTrack(g: Grid, path: TrackPath): TrackMask {
  const mask: TrackMask = {
    lane: new Uint8Array(g.w * g.h),
    dist: new Float32Array(g.w * g.h).fill(Infinity),
    sealed: new Uint8Array(g.w * g.h),
  };
  ensureArcs(g);

  for (const leg of path.legs) {
    const len = Math.hypot(leg.x1 - leg.x0, leg.z1 - leg.z0);
    const steps = Math.max(1, Math.ceil(len / 0.35));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      disc(g, mask, leg.x0 + (leg.x1 - leg.x0) * t, leg.z0 + (leg.z1 - leg.z0) * t, leg.half);
    }
  }

  for (const a of path.arcs) {
    const arcLen = a.r * a.span;
    const steps = Math.max(2, Math.ceil(arcLen / 0.35));
    // Fillets are carved at the MAIN width: a corner narrower than the straight
    // feeding it is a funnel, and a ball carrying pinball momentum into a funnel
    // wedges. Wider is always safe; narrower is a soft-lock. The path owns the
    // number so it stays in step with the archetype's lane scale — see
    // `TrackPath.arcHalf`.
    const half = path.arcHalf ?? 2;
    for (let s = 0; s <= steps; s++) {
      const ang = a.a0 + (a.span * s) / steps;
      disc(g, mask, a.cx + Math.cos(ang) * a.r, a.cz + Math.sin(ang) * a.r, half);
    }
  }

  return mask;
}

/**
 * Open one big CHAMBER on the circuit — the Great Hall's plaza.
 *
 * A disc rather than a rect, and carved into the lane mask rather than beside
 * it, so it is genuinely part of the track: the maze's keep-out margin respects
 * it, on-ramps can open onto its rim, and the endpoint picker will happily put
 * spawn or stairs in it. A chamber carved AFTER `growMazeAround` would instead
 * bulldoze finished corridors and leave severed stubs pointing into it.
 *
 * Pinball physics need open area to chain caroms and a 4-tile lane never gives
 * them any; this is the one place per floor where that is not true. Returns
 * null if the radius does not fit, so the caller skips the archetype's plaza
 * rather than carving a clipped one against the border.
 *
 * RETURNS THE CARVED DISC, not a boolean (Plaza A-1). The caller needs the
 * geometry, not the verdict: `buildTrackFloor` collects these into
 * `TrackFloor.chambers` and `floor-authoring.ts` hands them to `decorateMaze`
 * as its `rooms`, which is what finally gives a track floor an authored room.
 * For four years of this generator the answer was thrown away at the call site
 * and every downstream room system — `furnishRooms`' four archetypes, the
 * prefab stamps, the map overlay's per-archetype wash — ran against an empty
 * array on 100% of shipped floors.
 */
export function carveChamber(g: Grid, mask: TrackMask, cx: number, cz: number, r: number): Chamber | null {
  if (r < 3) return null;
  if (cx - r < 2 || cz - r < 2 || cx + r > g.w - 3 || cz + r > g.h - 3) return null;
  disc(g, mask, cx, cz, r);
  return { cx, cz, r };
}

/**
 * A carved chamber: centre and radius, in final tile coords.
 *
 * A DISC, deliberately — `chamberRoom` below converts it to the bounding
 * `Room` rect the decorator's API takes, and everything that emits into it has
 * to clip to real floor because the rect's corners are rock. See
 * `furnishRooms`.
 */
export interface Chamber {
  cx: number;
  cz: number;
  r: number;
}

/**
 * The bounding rect of a chamber, as the `Room` the decorator speaks.
 *
 * INTEGER TILES, and that is the whole reason this is a function rather than
 * an object literal at the call site. A chamber's centre and radius are FLOATS
 * — `hub.x`/`hub.z` are graph-node coordinates and the radius comes off
 * `Math.min(w, h) * prof.plazaFrac`, stepped down the relaxation ladder. `disc`
 * copes (it walks integer tiles and distance-tests against the float centre),
 * but a `Room` is an index range: hand `furnishRooms` a rect starting at
 * i0 = 23.3019 and every `room.i0 + 1` it computes is a fractional tile index
 * that addresses nothing. The first version of this shipped the raw floats and
 * the probe printed `36.379999999999995x36.379999999999995` — the rooms were
 * furnished with exactly zero parts because every emission missed the grid.
 *
 * The bounds mirror `disc`'s own loop, so the rect is exactly the tile range
 * the carve touched — no wider, and clamped off the border the same way.
 *
 * Still LOSSY, and safe only because of the clip downstream: a disc inscribed
 * in its bounding square leaves ~21% of that square as rock, concentrated in
 * the corners. `furnishRooms` clips every emission to `T_FLOOR` for exactly
 * this reason — do not add a consumer that skips that step.
 */
export function chamberRoom(g: Grid, c: Chamber): { i0: number; j0: number; w: number; h: number } {
  const i0 = Math.max(1, Math.floor(c.cx - c.r));
  const i1 = Math.min(g.w - 2, Math.ceil(c.cx + c.r));
  const j0 = Math.max(1, Math.floor(c.cz - c.r));
  const j1 = Math.min(g.h - 2, Math.ceil(c.cz + c.r));
  return { i0, j0, w: i1 - i0 + 1, h: j1 - j0 + 1 };
}

/**
 * Register the fillets as real ArcFeatures on the grid.
 *
 * MUST RUN AFTER `growMazeAround`. Publishing inside `carveTrack` looked
 * natural but marked shoulders that the maze and the connect pass then carved
 * back to floor — measured 20.6% of arc tiles orphaned that way, each one a
 * tile claiming curved collision on open ground.
 *
 * Carving the lane alone gives a curve you can DRIVE but not one you can SEE or
 * BOUNCE OFF: the collider and the wall mesh both reach a curved face through a
 * tile's `arcIdx` → `Grid.arcs` (tile-shape.ts), and without this pass the
 * corner is just tile-shaped floor with a stair-stepped rock edge. Every banked
 * turn would read as a jagged notch — the exact "why does this wall look
 * accidental" artefact the rework exists to remove.
 *
 * These fillets are CONVEX (solid inside the circle, ball sweeps the outside),
 * so the tiles to mark are the wall tiles just INSIDE the arc radius. Marking
 * only tiles that are actually wall keeps the pass safe by construction: it
 * changes no tile's walkability, so it cannot affect connectivity.
 */
export function publishArcs(g: Grid, path: TrackPath): void {
  ensureArcs(g);
  for (const a of path.arcs) {
    // Collect first, publish second. Taking `fi = g.arcs.length` up front and
    // then NOT pushing (when an arc owns no tiles) would leave every later
    // feature's tiles pointing one slot short — the collider would read a
    // neighbouring curve's geometry, which is the worst kind of see≠hit bug
    // because it looks almost right.
    const own: number[] = [];
    const steps = Math.max(8, Math.ceil((a.r * a.span) / 0.3));
    for (let s = 0; s <= steps; s++) {
      const ang = a.a0 + (a.span * s) / steps;
      // Walk inward from the lane's inner edge toward the arc centre, marking
      // the solid shoulder the ball rides against.
      //
      // The span has to reach PAST the carved lane. The fillet was swept with a
      // half-width-2 brush, so everything within ~2 tiles inside the radius is
      // the floor we just carved and only beyond that is the wall island the
      // curve wraps. Probing 0.5-1.6 found almost nothing: 124 arc tiles across
      // 113 features, i.e. barely a tile per curve, so the curves were
      // effectively unregistered and rendered as stair-stepped rock.
      for (let d = 2.0; d <= 4.5; d += 0.5) {
        const i = Math.floor(a.cx + Math.cos(ang) * (a.r - d));
        const j = Math.floor(a.cz + Math.sin(ang) * (a.r - d));
        if (i < 0 || j < 0 || i >= g.w || j >= g.h) continue;
        if (at(g, i, j) !== T_WALL) continue;
        if (shapeAt(g, i, j) === SHAPE_ARC) continue; // already owned
        own.push(idx(g, i, j));
      }
    }
    // Only keep a feature that actually owns tiles. An arc with no tiles is an
    // orphan the RENDERERS would still draw (they walk `g.arcs` directly, see
    // arc-sweeps.revertConcave) — a curved wall hanging in mid-air.
    if (!own.length) continue;
    const fi = g.arcs!.length;
    // Tagged as the CIRCUIT's own: the lane was carved to this radius, so this
    // curve is the racing line and never yields to a scavenged one when the
    // arc contract has to break a tie. See maze/arc-contract.ts.
    g.arcs!.push({ ...a, owner: "track" });
    for (const k of own) {
      g.shapes[k] = SHAPE_ARC;
      g.arcIdx![k] = fi;
    }
  }
}

/**
 * Grow the maze into everything the track didn't claim.
 *
 * A randomised-flood growth (a growing-tree over open cells) rather than the
 * classic perfect-maze backtracker, because a perfect maze would wall the track
 * off into a corridor with two exits. Here every carved cell is checked against
 * the track mask and a KEEP-OUT margin, so corridors approach the circuit and
 * stop — the circuit stays a circuit.
 *
 * `linkChance` then punches the ON-RAMPS: controlled openings from the maze
 * onto the track. That is the one place the two systems touch, and it is a
 * single tunable rather than an emergent accident.
 */
export function growMazeAround(
  g: Grid,
  mask: TrackMask,
  rng: () => number,
  opts: { margin?: number; linkChance?: number; density?: number; fill?: number } = {},
): void {
  const margin = opts.margin ?? 1;
  const linkChance = opts.linkChance ?? 0.28;
  const density = opts.density ?? 0.62;
  // How much of the leftover space the maze bothers to fill. Below 1 it leaves
  // solid rock between districts, which is what stops the surround reading as
  // uniform graph paper — a lattice that fills EVERY pocket makes the track
  // look like it was dropped onto a sheet of grid rather than built into a
  // place. Also: fewer corridors means each on-ramp matters more.
  const fill = opts.fill ?? 0.72;

  // A cell may be carved only if it is clear of the track by `margin`.
  const clearOfTrack = (i: number, j: number): boolean => {
    for (let dj = -margin; dj <= margin; dj++) {
      for (let di = -margin; di <= margin; di++) {
        const x = i + di;
        const y = j + dj;
        if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
        if (onLane(g, mask, x, y)) return false;
      }
    }
    return true;
  };

  // Odd-coordinate cell lattice, the same convention the shipped generator uses
  // (odd = cell, even = the wall between two cells), so downstream passes that
  // assume it keep working.
  const frontier: TilePos[] = [];
  const inMaze = new Uint8Array(g.w * g.h);

  // Seed from cells adjacent to the track — the maze grows OUT of the circuit,
  // which is what makes the layout read as "highways with districts hanging off
  // them" rather than two unrelated systems sharing a grid.
  for (let j = 1; j < g.h - 1; j += 2) {
    for (let i = 1; i < g.w - 1; i += 2) {
      if (!clearOfTrack(i, j)) continue;
      let nearTrack = false;
      for (let d = 1; d <= 3 && !nearTrack; d++) {
        for (const [di, dj] of [
          [d, 0],
          [-d, 0],
          [0, d],
          [0, -d],
        ] as const) {
          const x = i + di;
          const y = j + dj;
          if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
          if (onLane(g, mask, x, y)) nearTrack = true;
        }
      }
      if (nearTrack) frontier.push({ i, j });
    }
  }
  // Fall back to any legal cell if the track hugged the walls.
  if (!frontier.length) {
    for (let j = 1; j < g.h - 1; j += 2) {
      for (let i = 1; i < g.w - 1; i += 2) if (clearOfTrack(i, j)) frontier.push({ i, j });
    }
  }
  if (!frontier.length) return;

  // GROW FROM EVERY SEED, not one.
  //
  // A single seed only fills the pocket it happens to land in, and the track
  // cuts the leftover space into SEVERAL disjoint pockets — so one seed left
  // most of the floor as dead rock (observed: a floor 97% track with a single
  // tiny maze scrap). Seeding each pocket is also what guarantees the maze
  // reaches all the way around the circuit rather than bunching on one side.
  const active: TilePos[] = [];
  for (const f of frontier) {
    if (inMaze[idx(g, f.i, f.j)]) continue;
    // Skip a seed already reachable from an earlier one — it would just restart
    // growth inside a pocket that is being filled anyway.
    setTile(g, f.i, f.j, T_FLOOR);
    inMaze[idx(g, f.i, f.j)] = 1;
    active.push(f);
  }

  // Budget: stop once `fill` of the legal cells are carved, leaving rock.
  let legal = 0;
  for (let j = 1; j < g.h - 1; j += 2) for (let i = 1; i < g.w - 1; i += 2) if (clearOfTrack(i, j)) legal++;
  const budget = Math.max(1, Math.round(legal * fill));
  let carved = active.length;

  while (active.length && carved < budget) {
    // Growing-tree: mostly newest-first (long winding corridors), sometimes
    // random (branching). One knob spans backtracker↔Prim, same as the shipped
    // generator's `windiness`.
    const pick = rng() < density ? active.length - 1 : Math.floor(rng() * active.length);
    const c = active[pick];
    const dirs = [
      [2, 0],
      [-2, 0],
      [0, 2],
      [0, -2],
    ] as const;
    const order = [...dirs].sort(() => rng() - 0.5);
    let grew = false;
    for (const [di, dj] of order) {
      const ni = c.i + di;
      const nj = c.j + dj;
      if (ni < 1 || nj < 1 || ni >= g.w - 1 || nj >= g.h - 1) continue;
      if (inMaze[idx(g, ni, nj)]) continue;
      if (!clearOfTrack(ni, nj)) continue;
      const wi = c.i + di / 2;
      const wj = c.j + dj / 2;
      if (!clearOfTrack(wi, wj)) continue;
      setTile(g, wi, wj, T_FLOOR);
      setTile(g, ni, nj, T_FLOOR);
      inMaze[idx(g, ni, nj)] = 1;
      active.push({ i: ni, j: nj });
      carved++;
      grew = true;
      break;
    }
    if (!grew) active.splice(pick, 1);
  }

  // ON-RAMPS — the only sanctioned way in and out of the circuit.
  //
  // Without these the maze is a sealed district beside a sealed track and the
  // floor is unplayable. With too many, the circuit stops reading as a circuit
  // because it leaks into the maze everywhere. `linkChance` is the dial.
  for (let j = 1; j < g.h - 1; j++) {
    for (let i = 1; i < g.w - 1; i++) {
      if (at(g, i, j) !== T_WALL) continue;
      // A wall tile with track on one side and maze floor on the other.
      const touchesTrack =
        onLane(g, mask, i - 1, j) || onLane(g, mask, i + 1, j) || onLane(g, mask, i, j - 1) || onLane(g, mask, i, j + 1);
      if (!touchesTrack) continue;
      // A SEALED lane (the launch chute) takes no on-ramps. This is the pass
      // that was drilling them: it opens any wall with track on one side, and
      // the chute's side walls are exactly that. Measured before the check,
      // only 28/60 floors kept both chute walls intact.
      if (
        isSealed(g, mask, i - 1, j) ||
        isSealed(g, mask, i + 1, j) ||
        isSealed(g, mask, i, j - 1) ||
        isSealed(g, mask, i, j + 1)
      ) {
        continue;
      }
      let mazeSide = false;
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const x = i + di;
        const y = j + dj;
        if (isWalkable(g, x, y) && !onLane(g, mask, x, y)) mazeSide = true;
      }
      if (mazeSide && rng() < linkChance) setTile(g, i, j, T_FLOOR);
    }
  }

  widenMazeCorridors(g, mask, rng);
  connectAll(g, rng, sealedWalls(g, mask));
}

/**
 * WIDEN the maze from 1-wide slots into 2-wide corridors and small chambers.
 *
 * The maze is grown on the odd-coordinate cell lattice, so its corridors are
 * one tile wide. At this floor's final resolution that reads as graph paper —
 * spindly passages where every tile is walled on three sides — and it is why
 * a dead-end census reported 38.3 maze dead ends per floor while the track
 * itself had 0.1.
 *
 * Deleting them was tried first and is the wrong tool: an unbounded dead-end
 * cascade unravels a 1-wide corridor completely (each tile becomes a dead end
 * as soon as the one ahead is filled), which reduced off-track floor to 1.5%
 * of the grid — the maze vanished and the level read as one track blob.
 *
 * Widening fixes the cause instead. A 2-wide corridor has no 3-walled tiles by
 * construction, so the same passages stop reading as spindly WITHOUT deleting
 * any of the layout. It also matches the renderer's low-rim/tall-back
 * assumption, which is why the legacy generator ran `thickenWalls` at all.
 *
 * Only carves wall→floor (connectivity can only improve) and never touches the
 * track's keep-out margin, so the circuit keeps its shape.
 */
function widenMazeCorridors(g: Grid, mask: TrackMask, rng: () => number, chance = 0.72): void {
  const add: number[] = [];
  for (let j = 1; j < g.h - 1; j++) {
    for (let i = 1; i < g.w - 1; i++) {
      if (!isWalkable(g, i, j) || onLane(g, mask, i, j)) continue;
      // Widen toward a solid neighbour that is itself clear of the track, so
      // corridors thicken into the rock rather than eating into the lane's
      // shoulder.
      for (const [di, dj] of [
        [1, 0],
        [0, 1],
      ] as const) {
        const x = i + di;
        const y = j + dj;
        if (x < 1 || y < 1 || x >= g.w - 1 || y >= g.h - 1) continue;
        if (isWalkable(g, x, y)) continue;
        if (onLane(g, mask, x, y)) continue;
        // Keep off the lane's immediate shoulder (and any published arc rim).
        let nearLane = false;
        for (let dj2 = -1; dj2 <= 1 && !nearLane; dj2++)
          for (let di2 = -1; di2 <= 1; di2++) if (onLane(g, mask, x + di2, y + dj2)) nearLane = true;
        if (nearLane) continue;
        if (g.arcIdx && g.arcIdx[idx(g, x, y)] >= 0) continue;
        if (rng() < chance) add.push(idx(g, x, y));
      }
    }
  }
  // Applied after the scan so the result doesn't depend on scan order.
  for (const k of add) setTile(g, k % g.w, (k - (k % g.w)) / g.w, T_FLOOR);
}

/**
 * GUARANTEE ONE COMPONENT. Non-negotiable, and it must run last.
 *
 * The probabilistic on-ramp pass above is a look-and-feel dial, not a
 * connectivity mechanism, and treating it as one is a trap: it only considers
 * walls that TOUCH the track, so a district two corridors deep can never be
 * reached however high `linkChance` goes. Measured on the version without this
 * pass: 83 components on a single 70×44 floor, the track holding 54.6% of the
 * floor tiles and every maze pocket sealed — i.e. 75/75 test floors fragmented.
 *
 * So the invariant is enforced directly rather than hoped for. Flood from the
 * largest component, find any floor tile that wasn't reached, and punch the
 * shortest wall run back to reached space. Repeat until nothing is unreached.
 * Carving wall→floor only ever ADDS connectivity, so this cannot break anything
 * upstream, and it terminates because every pass strictly grows the reached set.
 *
 * `avoid` marks walls the repair should route AROUND if it can — today the
 * launch chute's side walls (track-launch.chuteKeepOut), which a shortest-path
 * corridor otherwise loves to punch straight through. It is a preference, not a
 * prohibition: if the only route to a stranded pocket crosses an avoided wall,
 * the search retries without the mask. Connectivity always wins.
 */
export function connectAll(g: Grid, rng: () => number, avoid?: Uint8Array): void {
  const N = g.w * g.h;
  const flood = (from: number): Uint8Array => {
    const seen = new Uint8Array(N);
    const st = [from];
    seen[from] = 1;
    while (st.length) {
      const k = st.pop()!;
      const i = k % g.w;
      const j = (k - i) / g.w;
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const x = i + di;
        const y = j + dj;
        if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
        const kk = idx(g, x, y);
        if (seen[kk] || !isWalkable(g, x, y)) continue;
        seen[kk] = 1;
        st.push(kk);
      }
    }
    return seen;
  };

  // Anchor on the biggest component — that is the track, and we want everything
  // else joined TO the circuit rather than to some stray pocket.
  let anchor = -1;
  let best = -1;
  const visited = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    if (visited[k] || !isWalkable(g, k % g.w, (k - (k % g.w)) / g.w)) continue;
    const seen = flood(k);
    let n = 0;
    for (let m = 0; m < N; m++)
      if (seen[m]) {
        n++;
        visited[m] = 1;
      }
    if (n > best) {
      best = n;
      anchor = k;
    }
  }
  if (anchor < 0) return;

  for (let guard = 0; guard < 400; guard++) {
    const seen = flood(anchor);
    // Any unreached floor tile is a stranded pocket.
    let target = -1;
    for (let k = 0; k < N; k++) {
      const i = k % g.w;
      const j = (k - i) / g.w;
      if (isWalkable(g, i, j) && !seen[k]) {
        target = k;
        break;
      }
    }
    if (target < 0) return; // one component — done

    // BFS through WALLS from the stranded tile until we touch reached space,
    // then carve that corridor. Shortest-path so the opening is minimal and the
    // circuit keeps its shape.
    //
    // Run once respecting `avoid`, and again ignoring it if that found nothing.
    // Ordering the attempts this way (rather than weighting one search) keeps
    // the guarantee crisp: pass 2 is exactly the search that shipped before, so
    // the mask can change which corridor gets carved but never whether one does.
    const search = (blocked: Uint8Array | undefined): { hit: number; prev: Int32Array } => {
      const prev = new Int32Array(N).fill(-1);
      const q: number[] = [target];
      const mark = new Uint8Array(N);
      mark[target] = 1;
      let hit = -1;
      while (q.length && hit < 0) {
        const k = q.shift()!;
        const i = k % g.w;
        const j = (k - i) / g.w;
        for (const [di, dj] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const x = i + di;
          const y = j + dj;
          if (x < 1 || y < 1 || x >= g.w - 1 || y >= g.h - 1) continue;
          const kk = idx(g, x, y);
          if (mark[kk]) continue;
          if (blocked && blocked[kk] && !seen[kk]) continue;
          mark[kk] = 1;
          prev[kk] = k;
          if (seen[kk]) {
            hit = kk;
            break;
          }
          q.push(kk);
        }
      }
      return { hit, prev };
    };
    let r = search(avoid);
    if (r.hit < 0 && avoid) r = search(undefined);
    if (r.hit < 0) return; // nothing reachable at all — leave it rather than loop
    for (let k = r.hit; k !== -1 && k !== target; k = r.prev[k]) {
      setTile(g, k % g.w, (k - (k % g.w)) / g.w, T_FLOOR);
    }
  }
}

/** Every tile the circuit claimed — used to keep later passes off the track. */
export function laneTiles(g: Grid, mask: TrackMask): TilePos[] {
  const out: TilePos[] = [];
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) if (onLane(g, mask, i, j)) out.push({ i, j });
  }
  return out;
}
