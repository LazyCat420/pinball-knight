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
 * BLUEPRINT §5) but v1 ships the backtracker only: long winding corridors,
 * claustrophobic, exactly the feel we want for the first levels.
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
}

export interface TilePos {
  i: number;
  j: number;
}

/**
 * Deterministic PRNG (mulberry32). The maze, spawns and torches for a level are
 * all drawn from one seeded stream, so a level can be regenerated exactly —
 * and the generator tests can assert on real mazes instead of mocking random.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
export function generateMaze(cellsW: number, cellsH: number, rng: () => number, braid = 0.12, windiness = 1): Grid {
  if (cellsW < 2 || cellsH < 2) throw new Error(`[dungeon] maze needs ≥2 cells per side, got ${cellsW}x${cellsH}`);

  const w = cellsW * 2 + 1;
  const h = cellsH * 2 + 1;
  const g: Grid = { w, h, t: new Uint8Array(w * h) }; // all T_WALL

  // Growing tree over cells. Cell (cx, cy) lives at tile (2cx+1, 2cy+1).
  const visited = new Uint8Array(cellsW * cellsH);
  const active: Array<[number, number]> = [[0, 0]];
  visited[0] = 1;
  setTile(g, 1, 1, T_FLOOR);

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

  // Braid: open some walls that sit between two floor tiles (never the border).
  if (braid > 0) {
    for (let j = 1; j < h - 1; j++) {
      for (let i = 1; i < w - 1; i++) {
        if (at(g, i, j) !== T_WALL) continue;
        const horizontal = at(g, i - 1, j) === T_FLOOR && at(g, i + 1, j) === T_FLOOR;
        const vertical = at(g, i, j - 1) === T_FLOOR && at(g, i, j + 1) === T_FLOOR;
        if ((horizontal || vertical) && rng() < braid) {
          setTile(g, i, j, T_FLOOR);
        }
      }
    }
  }

  return g;
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
  const out: Grid = { w, h, t: new Uint8Array(w * h) }; // all T_WALL
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
