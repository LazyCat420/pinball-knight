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
 * Generate a maze.
 *
 * `braid` is the probability of knocking through a wall that separates two
 * already-carved floor tiles. A perfect maze (braid 0) has exactly one path
 * between any two points, which makes every zombie encounter a corridor duel —
 * a little braiding opens loops so you can flank and flee. Removing a wall
 * between two floors can only ADD connectivity, so reachability is preserved
 * by construction.
 */
export function generateMaze(cellsW: number, cellsH: number, rng: () => number, braid = 0.12): Grid {
  if (cellsW < 2 || cellsH < 2) throw new Error(`[dungeon] maze needs ≥2 cells per side, got ${cellsW}x${cellsH}`);

  const w = cellsW * 2 + 1;
  const h = cellsH * 2 + 1;
  const g: Grid = { w, h, t: new Uint8Array(w * h) }; // all T_WALL

  // Backtracker over cells. Cell (cx, cy) lives at tile (2cx+1, 2cy+1).
  const visited = new Uint8Array(cellsW * cellsH);
  const stack: Array<[number, number]> = [[0, 0]];
  visited[0] = 1;
  setTile(g, 1, 1, T_FLOOR);

  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];

    // Unvisited neighbours, in a rng-shuffled order.
    const options: Array<[number, number]> = [];
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cellsW || ny >= cellsH) continue;
      if (!visited[ny * cellsW + nx]) options.push([nx, ny]);
    }

    if (!options.length) {
      stack.pop();
      continue;
    }

    const [nx, ny] = options[Math.floor(rng() * options.length)];
    visited[ny * cellsW + nx] = 1;
    // Carve the neighbour cell and the wall between.
    setTile(g, nx * 2 + 1, ny * 2 + 1, T_FLOOR);
    setTile(g, cx + nx + 1, cy + ny + 1, T_FLOOR);
    stack.push([nx, ny]);
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
