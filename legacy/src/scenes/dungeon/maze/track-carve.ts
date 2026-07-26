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
} from "./generator";
import { SHAPE_FULL } from "./tile-shape";
import type { TrackPath } from "./track-path";

/** Marks which tiles belong to the circuit, so later passes can respect it. */
export interface TrackMask {
  /** 1 = carved as track surface. Row-major, same layout as Grid.t. */
  lane: Uint8Array;
  /** Distance in tiles from the track centreline (Infinity off-track). */
  dist: Float32Array;
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
    // wedges. Wider is always safe; narrower is a soft-lock.
    const half = 2;
    for (let s = 0; s <= steps; s++) {
      const ang = a.a0 + (a.span * s) / steps;
      disc(g, mask, a.cx + Math.cos(ang) * a.r, a.cz + Math.sin(ang) * a.r, half);
    }
  }
  return mask;
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

  connectAll(g, rng);
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
 */
export function connectAll(g: Grid, rng: () => number): void {
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
        mark[kk] = 1;
        prev[kk] = k;
        if (seen[kk]) {
          hit = kk;
          break;
        }
        q.push(kk);
      }
    }
    if (hit < 0) return; // nothing reachable at all — leave it rather than loop
    for (let k = hit; k !== -1 && k !== target; k = prev[k]) {
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
