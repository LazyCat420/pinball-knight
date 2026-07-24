/**
 * Maze generation — recursive backtracker over a cell grid, emitted as a tile
 * grid where odd coordinates are cells and even coordinates are the walls
 * between them. A (cellsW × cellsH) maze becomes a (2w+1 × 2h+1) tile grid.
 *
 * DELIBERATELY DOM- and three-free: everything downstream (build, AI, collision,
 * spawn placement) reads only this Grid, and this module plus ai/collision are
 * the game's real test surface. Keep it pure.
 *
 * The algorithm is pluggable by design (Prim's, BSP rooms, caves — see
 * BLUEPRINT §5). What ships now is a GROWING-TREE generator parameterised by
 * `windiness`, which spans Prim's (pick a random frontier cell) through the
 * recursive backtracker (always pick the newest) — so the old "v1 ships the
 * backtracker only" note that used to sit here was wrong by the time you read
 * the implementation 75 lines below it. `braid` then punches loops.
 */

export const T_WALL = 0;
export const T_FLOOR = 1;
export const T_STAIRS = 2;
/**
 * A CRACKED wall — solid to collision like any wall, but pinball momentum past
 * SECRET_BREAK_SPEED shatters it (see secrets.ts). Placed by crackSecretWalls
 * on walls that separate two corridors, so every break opens a real shortcut.
 */
export const T_CRACKED = 3;

export interface Grid {
  w: number;
  h: number;
  /** Row-major tiles, `t[j * w + i]`. */
  t: Uint8Array;
  /**
   * Row-major per-tile SHAPE ids (tile-shape.ts), same layout as `t`. Default 0
   * = SHAPE_FULL (a plain square), so a grid that never assigns shapes behaves
   * exactly as before. Only meaningful on WALL tiles; walkability ignores it.
   */
  shapes: Uint8Array;
  /**
   * Multi-tile arc features (sweeping curved walls — tile-shape.ts ArcFeature).
   * A tile with SHAPE_ARC stores its feature's index in `arcIdx` (-1 = none).
   * OPTIONAL so hand-built test grids don't have to carry them; use
   * `ensureArcs(g)` before writing and `arcFeatureAt(g,i,j)` to read.
   */
  arcs?: import("./tile-shape").ArcFeature[];
  arcIdx?: Int16Array;
}

export interface TilePos {
  i: number;
  j: number;
}

/**
 * Deterministic PRNG (mulberry32). The maze, spawns and torches for a level are
 * all drawn from one seeded stream, so a level can be regenerated exactly —
 * and the generator tests can assert on real mazes instead of mocking random.
 *
 * Now lives in src/utils/rng.ts; re-exported here because the whole dungeon
 * imports it from this module.
 */
export { mulberry32 } from "../../../utils/rng";

export function idx(g: Grid, i: number, j: number): number {
  return j * g.w + i;
}

/** Tile lookup. Out of bounds reads as wall, so callers never bounds-check. */
export function at(g: Grid, i: number, j: number): number {
  if (i < 0 || j < 0 || i >= g.w || j >= g.h) return T_WALL;
  return g.t[idx(g, i, j)];
}

export function setTile(g: Grid, i: number, j: number, v: number): void {
  if (i < 0 || j < 0 || i >= g.w || j >= g.h) return;
  g.t[idx(g, i, j)] = v;
}

export function isWalkable(g: Grid, i: number, j: number): boolean {
  const t = at(g, i, j);
  return t === T_FLOOR || t === T_STAIRS;
}

/** Per-tile shape (tile-shape.ts). Out of bounds → 0 (SHAPE_FULL). */
export function shapeAt(g: Grid, i: number, j: number): number {
  if (i < 0 || j < 0 || i >= g.w || j >= g.h) return 0;
  return g.shapes[idx(g, i, j)];
}

export function setShape(g: Grid, i: number, j: number, v: number): void {
  if (i < 0 || j < 0 || i >= g.w || j >= g.h) return;
  g.shapes[idx(g, i, j)] = v;
}

/** Lazily create the arc-feature storage (see Grid.arcs). */
export function ensureArcs(g: Grid): void {
  if (!g.arcs) g.arcs = [];
  if (!g.arcIdx) g.arcIdx = new Int16Array(g.w * g.h).fill(-1);
}

/** The arc feature owning tile (i,j), or null (tile isn't an arc slice). */
export function arcFeatureAt(g: Grid, i: number, j: number): import("./tile-shape").ArcFeature | null {
  if (!g.arcs || !g.arcIdx) return null;
  if (i < 0 || j < 0 || i >= g.w || j >= g.h) return null;
  const a = g.arcIdx[idx(g, i, j)];
  return a >= 0 ? (g.arcs[a] ?? null) : null;
}

/**
 * World mapping: the maze is centred on the origin, one tile = one world unit,
 * so tile (i, j) occupies [i - w/2, i+1 - w/2] × [j - h/2, j+1 - h/2].
 */
export function tileCenter(g: Grid, i: number, j: number): { x: number; z: number } {
  return { x: i + 0.5 - g.w / 2, z: j + 0.5 - g.h / 2 };
}

export function worldToTile(g: Grid, x: number, z: number): TilePos {
  return { i: Math.floor(x + g.w / 2), j: Math.floor(z + g.h / 2) };
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** A cell-space coordinate pair, `[cx, cy]` — cell (cx, cy) is tile (2cx+1, 2cy+1). */
export type CellPos = readonly [number, number];

/**
 * Optional shaping for generateMaze. Both fields default to "off" and the
 * off path is bit-identical to the plain backtracker, so existing floors are
 * untouched by their presence.
 */
export interface MazeOpts {
  /**
   * Cells pre-carved and marked visited before the growing tree runs, so the
   * maze grows AROUND a shape rather than filling the whole rectangle
   * uniformly — the mechanism behind every floor archetype (archetypes.ts).
   * Need not be connected: stitchCells welds the result.
   */
  seeds?: ReadonlyArray<CellPos>;
  /**
   * Fill the seeded region SOLID — including the even/even corner tiles the
   * cell lattice would otherwise leave standing as pillars.
   *
   * Without this a "great hall" is really a hypostyle hall: welding adjacent
   * seeds opens the walls between cells but leaves a 1-tile pillar at every
   * corner, which thickenWalls then doubles into a 2×2 column every four tiles.
   * That is fine for a gallery and useless as an open arena to carom around,
   * which is the entire reason the archetype exists.
   *
   * Safe: carveRooms already fills its rects solid (corners included), so a
   * solid region is an established shape downstream, and thickenWalls' 2-thick
   * wall guarantee comes from the doubling itself rather than from the lattice.
   */
  solidSeeds?: boolean;
  /**
   * Tilt the braid probability across the floor in [0,1]: 0 is flat (the
   * classic behaviour), 1 ramps from 2× braid at the start corner to ~0× at
   * the far corner. See the braid pass for the exact ramp.
   */
  braidGradient?: number;
}

/**
 * Generate a maze via the **growing-tree** algorithm — one function that spans
 * a whole continuum of maze textures via `windiness`, so different floors can
 * feel structurally different instead of every level being the same winding
 * backtracker (the roadmap's "same pattern over and over" gap).
 *
 * At each step we hold a set of ACTIVE cells (carved but with maybe-unvisited
 * neighbours) and extend from one of them:
 *   - with probability `windiness`, from the NEWEST active cell → depth-first,
 *     long winding corridors with few junctions (recursive backtracker);
 *   - otherwise from a RANDOM active cell → breadth-ish frontier growth, bushy
 *     mazes with many short dead ends and junctions (randomized Prim's).
 * Intermediate values blend the two, so `windiness` 0.35 reads as "junction-y
 * with the odd long hall" — a genuinely different floor.
 *
 * `windiness = 1` is bit-identical to the old recursive backtracker: the
 * newest-cell path is exactly a stack, and the selection rng is only drawn when
 * it can actually change the pick (>1 active cell AND windiness < 1), so the
 * random stream — and therefore every downstream spawn/torch/room draw — is
 * unchanged for existing floors.
 *
 * `braid` is the probability of knocking through a wall that separates two
 * already-carved floor tiles. A perfect maze (braid 0) has exactly one path
 * between any two points, which makes every zombie encounter a corridor duel —
 * a little braiding opens loops so you can flank and flee. Removing a wall
 * between two floors can only ADD connectivity, so reachability is preserved
 * by construction.
 *
 * Whatever `windiness` and `braid` are, the output keeps the odd/even
 * cell-lattice discipline every downstream stage relies on (thickenWalls'
 * tall-back guarantee, 2×2 secret bands, room carving): floor cells sit at
 * (2c+1, 2c+1) and the only carved walls are the single tiles between two
 * adjacent cells.
 */
export function generateMaze(
  cellsW: number,
  cellsH: number,
  rng: () => number,
  braid = 0.12,
  windiness = 1,
  opts: MazeOpts = {},
): Grid {
  if (cellsW < 2 || cellsH < 2) throw new Error(`[dungeon] maze needs ≥2 cells per side, got ${cellsW}x${cellsH}`);

  const w = cellsW * 2 + 1;
  const h = cellsH * 2 + 1;
  const g: Grid = { w, h, t: new Uint8Array(w * h), shapes: new Uint8Array(w * h) }; // all T_WALL / SHAPE_FULL

  // Growing tree over cells. Cell (cx, cy) lives at tile (2cx+1, 2cy+1).
  const visited = new Uint8Array(cellsW * cellsH);
  const active: Array<[number, number]> = [];
  // SEEDED START (floor archetypes): instead of growing from the single cell
  // (0,0), a whole pre-carved SHAPE — a spine corridor, a great hall, a cave
  // blob — is marked visited up front and the maze grows out of it, filling
  // whatever the shape left over. That is what makes a floor's MACRO layout
  // differ instead of every level being a uniform-density maze. See
  // archetypes.ts. Adjacent seed cells get the wall between them opened so the
  // seeded shape reads as one continuous space, not a dotted lattice.
  const seeds = opts.seeds;
  if (seeds && seeds.length) {
    for (const [cx, cy] of seeds) {
      if (cx < 0 || cy < 0 || cx >= cellsW || cy >= cellsH) continue;
      if (visited[cy * cellsW + cx]) continue;
      visited[cy * cellsW + cx] = 1;
      setTile(g, cx * 2 + 1, cy * 2 + 1, T_FLOOR);
      active.push([cx, cy]);
    }
    // Weld the shape together (only ever carves wall→floor).
    for (const [cx, cy] of active) {
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cellsW || ny >= cellsH) continue;
        if (visited[ny * cellsW + nx]) setTile(g, cx + nx + 1, cy + ny + 1, T_FLOOR);
      }
    }
    // Knock out the corner pillars inside a solid region: wherever four seeds
    // form a 2×2 quad, the tile at their shared corner is floor too.
    if (opts.solidSeeds) {
      const isSeed = (cx: number, cy: number): boolean =>
        cx >= 0 && cy >= 0 && cx < cellsW && cy < cellsH && visited[cy * cellsW + cx] === 1;
      for (const [cx, cy] of active) {
        if (isSeed(cx + 1, cy) && isSeed(cx, cy + 1) && isSeed(cx + 1, cy + 1)) {
          setTile(g, cx * 2 + 2, cy * 2 + 2, T_FLOOR);
        }
      }
    }
  }
  if (!active.length) {
    // No seeds (or all out of range): the classic single-cell backtracker start.
    active.push([0, 0]);
    visited[0] = 1;
    setTile(g, 1, 1, T_FLOOR);
  }

  while (active.length) {
    // Which active cell to grow from — newest (windy) vs random (bushy). Only
    // spend an rng draw when the choice can actually differ, so windiness=1 and
    // single-cell states leave the stream bit-identical to the backtracker.
    const pick = active.length > 1 && windiness < 1 && rng() >= windiness ? Math.floor(rng() * active.length) : active.length - 1;
    const [cx, cy] = active[pick];

    // Unvisited neighbours, in DIRS order (rng only picks among them).
    const options: Array<[number, number]> = [];
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cellsW || ny >= cellsH) continue;
      if (!visited[ny * cellsW + nx]) options.push([nx, ny]);
    }

    if (!options.length) {
      // Exhausted — drop it. Swap-remove keeps random picks O(1); the newest
      // slot is the last element, so windiness=1 stays a true stack pop.
      active[pick] = active[active.length - 1];
      active.pop();
      continue;
    }

    const [nx, ny] = options[Math.floor(rng() * options.length)];
    visited[ny * cellsW + nx] = 1;
    // Carve the neighbour cell and the wall between.
    setTile(g, nx * 2 + 1, ny * 2 + 1, T_FLOOR);
    setTile(g, cx + nx + 1, cy + ny + 1, T_FLOOR);
    active.push([nx, ny]);
  }

  // Seeded shapes can leave two separate carved components touching but not
  // joined (each grew its own tree and stopped at the other's "visited" cells),
  // so weld the cell graph back into one piece. No-op for a single-seed maze,
  // and it draws no rng — the stream stays put either way.
  if (seeds && seeds.length) stitchCells(g, cellsW, cellsH);

  // Braid: open some walls that sit between two floor tiles (never the border).
  //
  // `braidGradient` tilts that probability across the floor instead of applying
  // it flat: at g>0 the region around the start cell (which decorate picks as
  // the player's spawn — the first walkable tile from the top-left) braids up
  // to (1+g)× and the far corner down to (1-g)×, so a floor opens loopy and
  // flankable and tightens into corridor duels as you push toward the stairs.
  // At the default 0 the probability is exactly `braid` everywhere and the
  // draw count is unchanged, so existing floors stay bit-identical.
  if (braid > 0) {
    const grad = opts.braidGradient ?? 0;
    const far = w + h; // Manhattan span, for normalising the ramp
    for (let j = 1; j < h - 1; j++) {
      for (let i = 1; i < w - 1; i++) {
        if (at(g, i, j) !== T_WALL) continue;
        const horizontal = at(g, i - 1, j) === T_FLOOR && at(g, i + 1, j) === T_FLOOR;
        const vertical = at(g, i, j - 1) === T_FLOOR && at(g, i, j + 1) === T_FLOOR;
        const p = grad === 0 ? braid : braid * (1 + grad * (1 - (2 * (i + j)) / far));
        if ((horizontal || vertical) && rng() < p) {
          setTile(g, i, j, T_FLOOR);
        }
      }
    }
  }

  return g;
}

/**
 * Weld the cell graph into ONE connected component by carving walls between
 * cells that are adjacent but not joined. Union-find over cell space: first
 * union everything the carve already connected, then open one wall per pair of
 * distinct components until a single component remains.
 *
 * Only ever carves wall→floor, only ever between two cell tiles, so both
 * downstream invariants survive: connectivity can only increase, and the
 * odd/even lattice discipline (walls at even coords between odd cells) holds.
 */
function stitchCells(g: Grid, cellsW: number, cellsH: number): void {
  const parent = new Int32Array(cellsW * cellsH);
  for (let k = 0; k < parent.length; k++) parent[k] = k;
  const find = (a: number): number => {
    let r = a;
    while (parent[r] !== r) r = parent[r];
    while (parent[a] !== r) {
      const next = parent[a];
      parent[a] = r;
      a = next;
    }
    return r;
  };
  const union = (a: number, b: number): boolean => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return false;
    parent[rb] = ra;
    return true;
  };

  // Pass 1: absorb the connections the maze already carved.
  for (let cy = 0; cy < cellsH; cy++) {
    for (let cx = 0; cx < cellsW; cx++) {
      const a = cy * cellsW + cx;
      if (cx + 1 < cellsW && at(g, cx * 2 + 2, cy * 2 + 1) !== T_WALL) union(a, a + 1);
      if (cy + 1 < cellsH && at(g, cx * 2 + 1, cy * 2 + 2) !== T_WALL) union(a, a + cellsW);
    }
  }
  // Pass 2: join whatever is still separate.
  for (let cy = 0; cy < cellsH; cy++) {
    for (let cx = 0; cx < cellsW; cx++) {
      const a = cy * cellsW + cx;
      if (cx + 1 < cellsW && union(a, a + 1)) setTile(g, cx * 2 + 2, cy * 2 + 1, T_FLOOR);
      if (cy + 1 < cellsH && union(a, a + cellsW)) setTile(g, cx * 2 + 1, cy * 2 + 2, T_FLOOR);
    }
  }
}

/**
 * A rectangular ROOM carved over the corridor maze — tile coords, inclusive of
 * (i0, j0), w×h tiles. Callers scale by 2 after thickenWalls.
 */
export interface Room {
  i0: number;
  j0: number;
  w: number;
  h: number;
}

/**
 * Carve `count` rectangular rooms into a generated maze (BEFORE thickenWalls).
 *
 * Rooms are placed in CELL space — a (cw × ch)-cell room spans the tiles from
 * one cell's tile to another's, walls between included — and clamped a cell
 * off the border. Connectivity is preserved by CONSTRUCTION: every odd/odd
 * tile inside the rect is a backtracker-carved cell, so the room is welded to
 * the maze everywhere it overlaps; carving walls to floor only ever ADDS
 * connectivity. Rooms don't overlap each other (one-tile mortar between).
 */
export function carveRooms(
  g: Grid,
  rng: () => number,
  count: number,
  minCells: number,
  maxCells: number,
): Room[] {
  const cellsW = (g.w - 1) / 2;
  const cellsH = (g.h - 1) / 2;
  const rooms: Room[] = [];

  for (let attempt = 0; attempt < count * 12 && rooms.length < count; attempt++) {
    const cw = minCells + Math.floor(rng() * (maxCells - minCells + 1));
    const ch = minCells + Math.floor(rng() * (maxCells - minCells + 1));
    if (cw + 2 > cellsW || ch + 2 > cellsH) continue; // maze too small for it
    const cx = 1 + Math.floor(rng() * (cellsW - cw - 1));
    const cy = 1 + Math.floor(rng() * (cellsH - ch - 1));
    // Cell rect → tile rect: first cell's tile to last cell's tile, inclusive.
    const room: Room = { i0: cx * 2 + 1, j0: cy * 2 + 1, w: cw * 2 - 1, h: ch * 2 - 1 };
    // Reject overlaps (with a 2-tile gap so two rooms keep a wall between them).
    const clash = rooms.some(
      (r) => room.i0 < r.i0 + r.w + 2 && r.i0 < room.i0 + room.w + 2 && room.j0 < r.j0 + r.h + 2 && r.j0 < room.j0 + room.h + 2,
    );
    if (clash) continue;
    for (let j = room.j0; j < room.j0 + room.h; j++) {
      for (let i = room.i0; i < room.i0 + room.w; i++) {
        setTile(g, i, j, T_FLOOR);
      }
    }
    rooms.push(room);
  }
  return rooms;
}

/**
 * Mark `count` walls as CRACKED secrets (BEFORE thickenWalls). Candidates are
 * exactly the braid candidates that stayed closed — a wall with floor on two
 * opposite sides — so smashing one always opens a genuine shortcut between two
 * corridors. Spaced out so a floor's secrets aren't bunched. Returns the raw
 * positions (callers scale by 2 post-thicken; each becomes a 2×2 band).
 */
export function crackSecretWalls(g: Grid, rng: () => number, count: number): TilePos[] {
  const candidates: TilePos[] = [];
  for (let j = 1; j < g.h - 1; j++) {
    for (let i = 1; i < g.w - 1; i++) {
      if (at(g, i, j) !== T_WALL) continue;
      const horizontal = at(g, i - 1, j) === T_FLOOR && at(g, i + 1, j) === T_FLOOR;
      const vertical = at(g, i, j - 1) === T_FLOOR && at(g, i, j + 1) === T_FLOOR;
      if (horizontal || vertical) candidates.push({ i, j });
    }
  }
  // rng-shuffle, then greedily keep spaced picks.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const picked: TilePos[] = [];
  for (const c of candidates) {
    if (picked.length >= count) break;
    if (picked.some((p) => Math.abs(p.i - c.i) + Math.abs(p.j - c.j) < 8)) continue;
    setTile(g, c.i, c.j, T_CRACKED);
    picked.push(c);
  }
  return picked;
}

/**
 * Uniform 2× upscale of the tile grid: corridors become 2 tiles wide, wall
 * bands 2 tiles thick.
 *
 * Why: Diablo's "walls only on the back edge of a tile" trick needs THICK
 * walls to work in 3D — with 1-tile walls, almost every east-west wall has a
 * corridor to its north and would have to render knee-high, and the dungeon
 * flattens back into a floor plan. With 2-tile bands, each band's north row
 * is the corridor's knee-high south rim and its south row is a full-height
 * back wall — depth everywhere, occlusion nowhere. And 2-wide corridors give
 * the horde and the camera room to breathe; 1-wide slots read as a mosaic.
 *
 * Pure duplication: connectivity is preserved exactly, braid openings become
 * 2×2 doorways.
 */
export function thickenWalls(g: Grid): Grid {
  const w = g.w * 2;
  const h = g.h * 2;
  const out: Grid = { w, h, t: new Uint8Array(w * h), shapes: new Uint8Array(w * h) }; // all T_WALL / SHAPE_FULL
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      const v = at(g, i, j);
      if (v === T_WALL) continue;
      setTile(out, i * 2, j * 2, v);
      setTile(out, i * 2 + 1, j * 2, v);
      setTile(out, i * 2, j * 2 + 1, v);
      setTile(out, i * 2 + 1, j * 2 + 1, v);
    }
  }
  return out;
}
