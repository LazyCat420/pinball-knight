/**
 * WALL RUNS — the compiler between a finished grid and the wall meshes.
 *
 * ── The complaint this exists to answer ──────────────────────────────────────
 * "Clusters of edge pieces / side pieces clustered to try to make a corner or a
 * wall." A long stretch of stone reads as a pile of fragments instead of one
 * wall. The renderer was NOT choosing corner pieces — there are no corner pieces
 * (maze/build.ts draws one identical box per exposed wall tile). What fragments
 * a wall is that every tile is decided ALONE:
 *
 *   - every tile top carries a bordered square with a carved panel, so a
 *     10-tile wall is ten squares (deliberate once — BLUEPRINT.md — and it is
 *     the thing under review);
 *   - every ~4th tall tile grows moss ("breaks up runs", by design);
 *   - a wall tip or a wide bend becomes a capless quarter-round shell
 *     (decorate.ts assignCornerShapes), which is a HOLE in the run's top;
 *   - pilasters and banners are hashed per tile with no idea where a wall ends.
 *
 * So the missing thing is not a piece library, it is the RUN: the maximal
 * stretch of wall that the eye reads as one object. This module derives runs
 * from the finished grid and hands the renderer a per-tile piece that knows
 * where it sits in its run. Nothing here draws; nothing here mutates the grid.
 *
 * ── What a run is ────────────────────────────────────────────────────────────
 * The camera sits SOUTH-EAST (engine/camera.ts, yaw 45°, tilt 38°) and box
 * materials are FrontSide, so the only surfaces of a wall box that can ever be
 * rasterised are its TOP, its SOUTH face and its EAST face.
 *
 * A run is a contiguous stretch of drawn wall tiles AT ONE HEIGHT. Height is the
 * only splitter, because `isLowWall` (engine/grid.ts) is gameplay rather than
 * styling — the croaker hops knee-high walls — so two heights are two objects
 * whatever they look like from here.
 *
 * ⚠️ Splitting on the drawn FACE as well was tried first and is wrong. It reads
 * plausibly (an x-run whose tiles all show a south face) and it fails on the
 * shape the complaint is about: at an L, the corner tile is the one tile whose
 * south neighbour is the other arm, so a face-split makes every corner a
 * one-tile run of its own — the model would MANUFACTURE the fragments it exists
 * to remove. A doorway opposite a wall did the same thing mid-run. The face is
 * per tile (`WallPiece.faceS`/`faceE`) and the dressing filters on it; it is not
 * a break in the stone.
 *
 * ── Why ownership is a rule and not a preference ─────────────────────────────
 * A corner tile is the last tile of a horizontal run AND the last tile of a
 * vertical one. If both runs keep it, both cap it, and the corner is drawn
 * twice — which is the "two edge pieces stacked in a corner" the complaint
 * describes. So the corner belongs to exactly one run: the LONGER one (ties go
 * to x). The shorter arm ends one tile early against a `corner-*` end. Every
 * box tile is therefore in exactly one run, and `Σ run lengths === box count`
 * is a coverage invariant a test can assert rather than a claim.
 *
 * DOM- and three-free, so vitest can hold the whole model.
 */
import { type Grid, isWalkable, isLowWall, tileCenter, at, shapeAt, T_CRACKED, idx } from "./generator";
import { isShaped, isArc, type TileShape } from "../engine/tile-shape";

/** Which wall treatment a floor is rendered with. `legacy` = the shipped per-tile look. */
export type WallLook = "legacy" | "runs" | "tiles";

export type Axis = "x" | "z";

/**
 * What sits one step past a run's end. The renderer does not use every value —
 * they are separated because a run that stops at a doorway is a different
 * FINDING from one that stops at a curved shell, and the diagnostics have to be
 * able to say which.
 */
export type EndKind =
  | "open" // floor: a free end, the wall genuinely stops here
  | "edge" // off the grid
  | "shaped" // a slant prism / round shell (decorate.assignCornerShapes)
  | "arc" // a slice of a multi-tile arc sweep (Grid.arcs)
  | "cracked" // a secret band (drawn by its own removable meshes)
  | "buried" // solid stone nobody can see
  | "height" // the same wall, knee-high on the other side of this line
  | "corner-convex" // an L whose OUTER diagonal is floor (a wall-mass corner)
  | "corner-concave" // an L whose INNER diagonal is floor (floor wraps the crook)
  | "corner-thin" // an L in a 1-thick partition: floor on both diagonals
  | "tee"; // this run ends against another run's middle

/** A run's role for one tile. `corner`/`tee` are the ends/bodies that OWN a junction. */
export type Role = "solo" | "end" | "body" | "corner" | "tee";

/** Cap-border bits — a set bit means "draw the grid border on this side". */
export const CAP_N = 1;
export const CAP_E = 2;
export const CAP_S = 4;
export const CAP_W = 8;
export const CAP_ALL = CAP_N | CAP_E | CAP_S | CAP_W;

export interface RunEnd {
  kind: EndKind;
  /** The run on the other side of a `corner-*` or `tee` end. */
  other?: number;
}

export interface WallRun {
  id: number;
  axis: Axis;
  /** Head tile (west end of an x-run, north end of a z-run). */
  i0: number;
  j0: number;
  n: number;
  low: boolean;
  /** How many of the run's tiles draw their along-axis face (south for x, east for z). */
  faces: number;
  /** Moss is decided ONCE per run — the legacy hash read at the head tile. */
  moss: boolean;
  /** [head end, tail end] */
  ends: [RunEnd, RunEnd];
}

export interface WallPiece {
  i: number;
  j: number;
  /** World centre, so build.ts does not recompute it. */
  x: number;
  z: number;
  run: number;
  role: Role;
  low: boolean;
  moss: boolean;
  faceS: boolean;
  faceE: boolean;
  /** CAP_* bits: which sides of the top face draw the grid border. */
  capMask: number;
}

export interface WallRunStats {
  boxes: number;
  faces: { top: number; south: number; east: number };
  runs: number;
  ends: number;
  bodies: number;
  corners: number;
  tees: number;
  solos: number;
  /** Buried tiles that sit between two mates of one run — holes a run could bridge. */
  bridgeable: number;
  /** Run-length histogram, capped at 20 like the census. */
  byLen: Record<number, number>;
  /** Ends by kind — the diagnostic that says WHAT is chopping the walls up. */
  byEnd: Record<string, number>;
  /** Shape candidates the grammar vetoed (phase 2; 0 when the veto is off). */
  rejected: number;
}

export interface WallRunPlan {
  w: number;
  h: number;
  look: Exclude<WallLook, "legacy">;
  runs: WallRun[];
  pieces: WallPiece[];
  /** tile index → index into `pieces`, or -1. */
  pieceAt: Int32Array;
  stats: WallRunStats;
}

export interface CompileOpts {
  /**
   * Fuse the cap border between ANY two adjacent same-height drawn boxes, not
   * just two tiles of one run. On (the default) a wall mass reads as one
   * outlined shape; off, each run keeps its own outline.
   */
  fuseJunctions?: boolean;
}

// ── Tile classification — the same predicates maze/build.ts draws by ──────────

export const K_FLOOR = 0;
export const K_CRACKED = 1;
export const K_BURIED = 2;
export const K_SHAPED = 3;
export const K_ARC = 4;
export const K_BOX = 5;

/**
 * Is this wall tile drawn at all? build.ts skips a tile with no walkable
 * neighbour in any of the 8 directions — stone inside a block that no camera
 * angle can reach.
 */
function exposed(g: Grid, i: number, j: number): boolean {
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      if (isWalkable(g, i + di, j + dj)) return true;
    }
  }
  return false;
}

/** Per-tile kind for the whole grid (row-major, `idx` order). */
export function classifyTiles(g: Grid): Uint8Array {
  const out = new Uint8Array(g.w * g.h);
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      const k = idx(g, i, j);
      if (isWalkable(g, i, j)) {
        out[k] = K_FLOOR;
        continue;
      }
      if (at(g, i, j) === T_CRACKED) {
        out[k] = K_CRACKED;
        continue;
      }
      if (!exposed(g, i, j)) {
        out[k] = K_BURIED;
        continue;
      }
      const shape = shapeAt(g, i, j);
      if (isShaped(shape)) {
        out[k] = isArc(shape) ? K_ARC : K_SHAPED;
        continue;
      }
      out[k] = K_BOX;
    }
  }
  return out;
}

/**
 * The moss hash, exactly as build.ts rolls it (`(i * 7 + j * 13) % 4 === 0`).
 * Kept as a named function because the run look asks it ONCE per run instead of
 * once per tile, and a second copy of the arithmetic is how the two looks would
 * drift apart.
 */
export function mossHash(i: number, j: number): boolean {
  return (i * 7 + j * 13) % 4 === 0;
}

// ── The legacy triage, as a function ─────────────────────────────────────────

export interface LegacyTriage {
  full: Array<{ x: number; z: number; i: number; j: number }>;
  moss: Array<{ x: number; z: number; i: number; j: number }>;
  low: Array<{ x: number; z: number; i: number; j: number }>;
  southFaces: Array<{ x: number; z: number; i: number; j: number }>;
  slant: Array<{ x: number; z: number; i: number; j: number; shape: TileShape; low: boolean }>;
  /** Per arc feature: is any slice of it on the camera-side rim? */
  arcRim: Map<number, boolean>;
}

/**
 * maze/build.ts's original per-tile wall scan, lifted verbatim so the shipped
 * look has ONE implementation instead of two that can disagree. Emission order
 * is row-major, which is what fixes instance indices — `MazeHandle.wallAt` maps
 * a tile to (mesh, index) and secrets.ts / wall-erosion.ts write through it.
 *
 * `dev/fixtures/wall-legacy-triage.json` pins the output of the ORIGINAL inline
 * loop (sliced out of build.ts at commit c9a05458 and run over 31 floors), so
 * this reproduction is checked against the code it replaces rather than against
 * itself.
 */
export function legacyTriage(g: Grid): LegacyTriage {
  const full: LegacyTriage["full"] = [];
  const moss: LegacyTriage["moss"] = [];
  const low: LegacyTriage["low"] = [];
  const southFaces: LegacyTriage["southFaces"] = [];
  const slant: LegacyTriage["slant"] = [];
  const arcRim = new Map<number, boolean>();
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      if (isWalkable(g, i, j)) continue;
      if (at(g, i, j) === T_CRACKED) continue;
      if (!exposed(g, i, j)) continue;
      const rim = isLowWall(g, i, j);
      const cc = tileCenter(g, i, j);
      const c = { x: cc.x, z: cc.z, i, j };
      const shape = shapeAt(g, i, j);
      if (isShaped(shape)) {
        if (isArc(shape)) {
          const fid = g.arcIdx ? g.arcIdx[idx(g, i, j)] : -1;
          if (fid >= 0) arcRim.set(fid, (arcRim.get(fid) ?? false) || rim);
        } else {
          slant.push({ x: cc.x, z: cc.z, i, j, shape, low: rim });
        }
        continue;
      }
      if (rim) low.push(c);
      else if (mossHash(i, j)) moss.push(c);
      else full.push(c);
      if (!rim && isWalkable(g, i, j + 1)) southFaces.push({ x: c.x, z: c.z, i, j });
    }
  }
  return { full, moss, low, southFaces, slant, arcRim };
}

// ── Runs ─────────────────────────────────────────────────────────────────────

interface RunScan {
  /** tile → maximal-run id for this axis, or -1. */
  id: Int32Array;
  /** run id → length. */
  len: number[];
}

/** Maximal runs along one axis: contiguous drawn boxes at one height (see the header). */
function scanAxis(g: Grid, kind: Uint8Array, low: Uint8Array, axis: Axis): RunScan {
  const id = new Int32Array(g.w * g.h).fill(-1);
  const len: number[] = [];
  const di = axis === "x" ? 1 : 0;
  const dj = axis === "x" ? 0 : 1;
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      const k = idx(g, i, j);
      if (kind[k] !== K_BOX || id[k] >= 0) continue;
      // Only start at a run HEAD, so every run is walked once.
      const pi = i - di;
      const pj = j - dj;
      if (pi >= 0 && pj >= 0) {
        const pk = idx(g, pi, pj);
        if (kind[pk] === K_BOX && low[pk] === low[k]) continue;
      }
      const run = len.length;
      let n = 0;
      let x = i;
      let y = j;
      while (x < g.w && y < g.h) {
        const kk = idx(g, x, y);
        if (kind[kk] !== K_BOX || low[kk] !== low[k]) break;
        id[kk] = run;
        n++;
        x += di;
        y += dj;
      }
      len.push(n);
    }
  }
  return { id, len };
}

interface Compiled {
  kind: Uint8Array;
  low: Uint8Array;
  openS: Uint8Array;
  openE: Uint8Array;
  ownerX: Uint8Array; // 1 = this tile belongs to its x-run
  finalId: Int32Array;
  runs: WallRun[];
  /** run id → tile indices in order. */
  members: number[][];
}

function compileRuns(g: Grid): Compiled {
  const n = g.w * g.h;
  const kind = classifyTiles(g);
  const low = new Uint8Array(n);
  const openS = new Uint8Array(n);
  const openE = new Uint8Array(n);
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      const k = idx(g, i, j);
      if (kind[k] !== K_BOX) continue;
      low[k] = isLowWall(g, i, j) ? 1 : 0;
      openS[k] = isWalkable(g, i, j + 1) ? 1 : 0;
      openE[k] = isWalkable(g, i + 1, j) ? 1 : 0;
    }
  }
  const sx = scanAxis(g, kind, low, "x");
  const sz = scanAxis(g, kind, low, "z");

  // Ownership: the longer arm keeps the shared tile; ties go to x. This is the
  // rule that makes a corner belong to exactly one run.
  const ownerX = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    if (kind[k] !== K_BOX) continue;
    ownerX[k] = sx.len[sx.id[k]] >= sz.len[sz.id[k]] ? 1 : 0;
  }

  // Re-segment each maximal run into the stretch it still owns.
  const finalId = new Int32Array(n).fill(-1);
  const runs: WallRun[] = [];
  const members: number[][] = [];
  const walk = (axis: Axis, scan: RunScan, wantX: number): void => {
    const di = axis === "x" ? 1 : 0;
    const dj = axis === "x" ? 0 : 1;
    for (let j = 0; j < g.h; j++) {
      for (let i = 0; i < g.w; i++) {
        const k = idx(g, i, j);
        if (kind[k] !== K_BOX || ownerX[k] !== wantX || finalId[k] >= 0) continue;
        const pi = i - di;
        const pj = j - dj;
        if (pi >= 0 && pj >= 0) {
          const pk = idx(g, pi, pj);
          if (scan.id[pk] === scan.id[k] && ownerX[pk] === wantX) continue; // not the head
        }
        const id = runs.length;
        const mem: number[] = [];
        let x = i;
        let y = j;
        while (x < g.w && y < g.h) {
          const kk = idx(g, x, y);
          if (scan.id[kk] !== scan.id[k] || ownerX[kk] !== wantX) break;
          finalId[kk] = id;
          mem.push(kk);
          x += di;
          y += dj;
        }
        members.push(mem);
        runs.push({
          id,
          axis,
          i0: i,
          j0: j,
          n: mem.length,
          low: low[k] === 1,
          faces: mem.reduce((n, m) => n + ((axis === "x" ? openS[m] : openE[m]) === 1 ? 1 : 0), 0),
          moss: low[k] === 0 && mossHash(i, j),
          ends: [
            { kind: "open" },
            { kind: "open" },
          ],
        });
      }
    }
  };
  walk("x", sx, 1);
  walk("z", sz, 0);

  return { kind, low, openS, openE, ownerX, finalId, runs, members };
}

/** What sits one step past `(bi,bj)` from a run travelling along `axis`. */
function endKind(g: Grid, c: Compiled, run: WallRun, endTile: number, bi: number, bj: number, dirI: number, dirJ: number): RunEnd {
  if (bi < 0 || bj < 0 || bi >= g.w || bj >= g.h) return { kind: "edge" };
  const bk = idx(g, bi, bj);
  switch (c.kind[bk]) {
    case K_FLOOR:
      return { kind: "open" };
    case K_CRACKED:
      return { kind: "cracked" };
    case K_BURIED:
      return { kind: "buried" };
    case K_SHAPED:
      return { kind: "shaped" };
    case K_ARC:
      return { kind: "arc" };
  }
  // A box at the same height was a mate: the only reason it is not in this run
  // is that the other axis owns it.
  if (c.low[bk] !== c.low[endTile]) return { kind: "height", other: c.finalId[bk] };

  const other = c.runs[c.finalId[bk]];
  const isEndOfOther = other.n === 1 || c.members[other.id][0] === bk || c.members[other.id][other.n - 1] === bk;
  if (!isEndOfOther) return { kind: "tee", other: other.id };

  // An L. Which way the corner reads depends on which diagonal is open: the
  // INNER one (the crook the two arms enclose) or the OUTER one.
  const oi = other.axis === "x" ? 1 : 0;
  const oj = other.axis === "x" ? 0 : 1;
  // The other arm leaves `b` along ±(oi,oj); pick the direction that has a
  // member of `other` (or, for a 1-tile run, either — it reads as thin).
  let sign = 0;
  for (const s of [1, -1]) {
    const ni = bi + oi * s;
    const nj = bj + oj * s;
    if (ni < 0 || nj < 0 || ni >= g.w || nj >= g.h) continue;
    if (c.finalId[idx(g, ni, nj)] === other.id) sign = s;
  }
  if (sign === 0) return { kind: "corner-thin", other: other.id };
  // Inner = the diagonal enclosed by both arms; outer = the opposite one.
  const inI = bi - dirI + oi * sign;
  const inJ = bj - dirJ + oj * sign;
  const outI = bi + dirI - oi * sign;
  const outJ = bj + dirJ - oj * sign;
  const inner = isWalkable(g, inI, inJ);
  const outer = isWalkable(g, outI, outJ);
  if (inner && outer) return { kind: "corner-thin", other: other.id };
  if (inner) return { kind: "corner-concave", other: other.id };
  return { kind: "corner-convex", other: other.id };
}

/**
 * Compile the finished grid into runs and per-tile pieces.
 *
 * `look`:
 *   "runs"  — a run is one object: the cap border is drawn on the OUTLINE of
 *             the wall mass, never between two tiles of the same wall.
 *   "tiles" — the shipped square-per-tile cap, but everything else run-aware
 *             (moss per run, dressing on run interiors only).
 */
export function compileWallRuns(g: Grid, look: Exclude<WallLook, "legacy">, opts: CompileOpts = {}): WallRunPlan {
  const fuseJunctions = opts.fuseJunctions ?? true;
  const c = compileRuns(g);
  const n = g.w * g.h;

  // Ends.
  for (const run of c.runs) {
    const mem = c.members[run.id];
    const di = run.axis === "x" ? 1 : 0;
    const dj = run.axis === "x" ? 0 : 1;
    const headK = mem[0];
    const tailK = mem[run.n - 1];
    const hi = run.i0;
    const hj = run.j0;
    const ti = run.i0 + di * (run.n - 1);
    const tj = run.j0 + dj * (run.n - 1);
    run.ends[0] = endKind(g, c, run, headK, hi - di, hj - dj, -di, -dj);
    run.ends[1] = endKind(g, c, run, tailK, ti + di, tj + dj, di, dj);
  }

  // Roles. A run's extremities are ends, its middle bodies; a junction then
  // promotes the tile that OWNS it (`corner` for an end, `tee` for a body) so
  // the diagnostics can colour who owns what.
  const role = new Array<Role>(n);
  for (const run of c.runs) {
    const mem = c.members[run.id];
    for (let p = 0; p < mem.length; p++) {
      role[mem[p]] = run.n === 1 ? "solo" : p === 0 || p === mem.length - 1 ? "end" : "body";
    }
  }
  // A junction is owned by the tile it lands ON, exactly once.
  for (const run of c.runs) {
    const di = run.axis === "x" ? 1 : 0;
    const dj = run.axis === "x" ? 0 : 1;
    const sides: Array<[number, number]> = [
      [run.i0 - di, run.j0 - dj],
      [run.i0 + di * run.n, run.j0 + dj * run.n],
    ];
    run.ends.forEach((e, s) => {
      if (e.other === undefined) return;
      const [bi, bj] = sides[s];
      if (bi < 0 || bj < 0 || bi >= g.w || bj >= g.h) return;
      const bk = idx(g, bi, bj);
      if (e.kind === "tee") role[bk] = "tee";
      else if (e.kind.startsWith("corner")) role[bk] = "corner";
    });
  }

  // Cap borders. A side is bordered unless it is fused into a neighbour.
  const drawn = (k: number): boolean => c.kind[k] === K_BOX;
  const capMaskAtTile = (i: number, j: number, k: number): number => {
    if (look === "tiles") return CAP_ALL;
    let mask = 0;
    const sides: Array<[number, number, number]> = [
      [0, -1, CAP_N],
      [1, 0, CAP_E],
      [0, 1, CAP_S],
      [-1, 0, CAP_W],
    ];
    for (const [di, dj, bit] of sides) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= g.w || nj >= g.h) {
        mask |= bit;
        continue;
      }
      const nk = idx(g, ni, nj);
      const fused =
        drawn(nk) &&
        c.low[nk] === c.low[k] &&
        (c.finalId[nk] === c.finalId[k] || fuseJunctions);
      if (!fused) mask |= bit;
    }
    return mask;
  };

  // Pieces, emitted row-major so instance order stays stable across rebuilds.
  const pieces: WallPiece[] = [];
  const pieceAt = new Int32Array(n).fill(-1);
  let southCount = 0;
  let eastCount = 0;
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      const k = idx(g, i, j);
      if (c.kind[k] !== K_BOX) continue;
      const run = c.runs[c.finalId[k]];
      const cc = tileCenter(g, i, j);
      pieceAt[k] = pieces.length;
      if (c.openS[k]) southCount++;
      if (c.openE[k]) eastCount++;
      pieces.push({
        i,
        j,
        x: cc.x,
        z: cc.z,
        run: run.id,
        role: role[k],
        low: c.low[k] === 1,
        moss: !run.low && run.moss,
        faceS: c.openS[k] === 1,
        faceE: c.openE[k] === 1,
        capMask: capMaskAtTile(i, j, k),
      });
    }
  }

  // Buried holes: stone with no visible face that nonetheless sits between two
  // tiles of one run. Counted, not drawn — the number says whether bridging
  // them would be worth a knob.
  let bridgeable = 0;
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      const k = idx(g, i, j);
      if (c.kind[k] !== K_BURIED) continue;
      for (const [di, dj] of [[1, 0], [0, 1]] as const) {
        const a = i - di >= 0 && j - dj >= 0 ? idx(g, i - di, j - dj) : -1;
        const b = i + di < g.w && j + dj < g.h ? idx(g, i + di, j + dj) : -1;
        if (a < 0 || b < 0) continue;
        if (c.kind[a] === K_BOX && c.kind[b] === K_BOX && c.low[a] === c.low[b]) {
          bridgeable++;
          break;
        }
      }
    }
  }

  const byLen: Record<number, number> = {};
  const byEnd: Record<string, number> = {};
  for (const run of c.runs) {
    const bucket = Math.min(run.n, 20);
    byLen[bucket] = (byLen[bucket] ?? 0) + 1;
    for (const e of run.ends) byEnd[e.kind] = (byEnd[e.kind] ?? 0) + 1;
  }
  const count = (r: Role): number => pieces.reduce((s, p) => s + (p.role === r ? 1 : 0), 0);

  return {
    w: g.w,
    h: g.h,
    look,
    runs: c.runs,
    pieces,
    pieceAt,
    stats: {
      boxes: pieces.length,
      faces: { top: pieces.length, south: southCount, east: eastCount },
      runs: c.runs.length,
      ends: count("end"),
      bodies: count("body"),
      corners: count("corner"),
      tees: count("tee"),
      solos: count("solo"),
      bridgeable,
      byLen,
      byEnd,
      rejected: 0,
    },
  };
}

/**
 * Tiles that are the MIDDLE of a wall run of at least `minRun` tiles.
 *
 * This is what decorate.ts asks before it turns a wall tile into a quarter-round
 * shell: a shell in the middle of a wall is the hole that makes a run read as
 * fragments. Computed on the grid as it stands BEFORE shapes are assigned,
 * which is the run the player would have seen without the shell.
 */
export function runInteriorMask(g: Grid, minRun = 3): Uint8Array {
  const c = compileRuns(g);
  const out = new Uint8Array(g.w * g.h);
  for (const run of c.runs) {
    if (run.n < minRun) continue;
    const mem = c.members[run.id];
    for (let p = 1; p < mem.length - 1; p++) out[mem[p]] = 1;
  }
  return out;
}

/** Length of the run each box tile belongs to (0 for anything not drawn as a box). */
export function runLengthMask(g: Grid): Int32Array {
  const c = compileRuns(g);
  const out = new Int32Array(g.w * g.h);
  for (const run of c.runs) for (const k of c.members[run.id]) out[k] = run.n;
  return out;
}
