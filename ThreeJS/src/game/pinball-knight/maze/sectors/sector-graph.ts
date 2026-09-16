/**
 * Sector Graph Generator & Macro-Routing Layer
 *
 * Implements high-level topological planning for large floors:
 *  - Divides map into discrete sectors (default 32x32 tiles).
 *  - Assigns districts: entry, exploration, mechanism hubs, landmark elites,
 *    boss antechamber, and boss arena.
 *  - Guarantees topological distance between start and boss.
 */
import type { Grid, TilePos } from "../generator";
import type { SectorGraph, SectorNode, SectorBounds } from "./sector-types";

export const DEFAULT_SECTOR_SIZE = 32;
export const BOSS_EXCLUSION_RADIUS_TILES = 25;

export interface SectorGraphOptions {
  sectorSize?: number;
  start?: TilePos;
  stairs?: TilePos;
}

/**
 * Returns the sector ID containing tile coordinate (i, j).
 */
export function sectorIdForTile(i: number, j: number, cols: number, sectorSize: number = DEFAULT_SECTOR_SIZE): number {
  const col = Math.floor(i / sectorSize);
  const row = Math.floor(j / sectorSize);
  return row * cols + col;
}

/**
 * Computes bounding box for sector at (col, row).
 */
export function sectorBounds(col: number, row: number, gW: number, gH: number, sectorSize: number = DEFAULT_SECTOR_SIZE): SectorBounds {
  const minI = col * sectorSize;
  const minJ = row * sectorSize;
  const maxI = Math.min(gW - 1, (col + 1) * sectorSize - 1);
  const maxJ = Math.min(gH - 1, (row + 1) * sectorSize - 1);
  return { minI, maxI, minJ, maxJ };
}

/**
 * Build a macro sector graph covering the full grid.
 */
export function buildSectorGraph(g: Grid, opts: SectorGraphOptions = {}): SectorGraph {
  const sectorSize = opts.sectorSize ?? DEFAULT_SECTOR_SIZE;
  const cols = Math.max(1, Math.ceil(g.w / sectorSize));
  const rows = Math.max(1, Math.ceil(g.h / sectorSize));
  const totalSectors = cols * rows;

  const startTile = opts.start ?? { i: 2, j: 2 };
  const stairsTile = opts.stairs ?? { i: g.w - 3, j: g.h - 3 };

  const entrySectorId = Math.min(
    totalSectors - 1,
    Math.max(0, sectorIdForTile(startTile.i, startTile.j, cols, sectorSize)),
  );
  let bossArenaSectorId = Math.min(
    totalSectors - 1,
    Math.max(0, sectorIdForTile(stairsTile.i, stairsTile.j, cols, sectorSize)),
  );

  // If entry and boss end up in same sector (on small maps), push boss to opposite corner
  if (bossArenaSectorId === entrySectorId && totalSectors > 1) {
    bossArenaSectorId = totalSectors - 1;
  }

  // Build sector nodes
  const sectors: SectorNode[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = r * cols + c;
      const bounds = sectorBounds(c, r, g.w, g.h, sectorSize);
      sectors.push({
        id,
        col: c,
        row: r,
        bounds,
        role: "exploration_maze",
        theme: "default",
        gateways: [],
        walkableTiles: 0,
        hasLandmark: false,
        hasMechanismHub: false,
      });
    }
  }

  // Compute Manhattan hop distances on sector grid from entry
  const entryCol = entrySectorId % cols;
  const entryRow = Math.floor(entrySectorId / cols);
  const hopDistances = new Array<number>(totalSectors);
  for (let i = 0; i < totalSectors; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    hopDistances[i] = Math.abs(c - entryCol) + Math.abs(r - entryRow);
  }

  // Find neighbor sector to boss arena with shortest hop to serve as antechamber
  const bossCol = bossArenaSectorId % cols;
  const bossRow = Math.floor(bossArenaSectorId / cols);
  let bestAntechamberId = bossArenaSectorId;
  let minHopToBoss = Infinity;

  const CARDINALS: readonly [number, number][] = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];

  for (const [dc, dr] of CARDINALS) {
    const nc = bossCol + dc;
    const nr = bossRow + dr;
    if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) {
      const nid = nr * cols + nc;
      if (hopDistances[nid] < minHopToBoss) {
        minHopToBoss = hopDistances[nid];
        bestAntechamberId = nid;
      }
    }
  }

  const bossAntechamberSectorId = bestAntechamberId;

  // Assign sector roles
  for (const s of sectors) {
    if (s.id === entrySectorId) {
      s.role = "entry_district";
    } else if (s.id === bossArenaSectorId) {
      s.role = "boss_arena";
    } else if (s.id === bossAntechamberSectorId) {
      s.role = "boss_antechamber";
    } else {
      const hop = hopDistances[s.id];
      if (hop === 1) {
        s.role = "exploration_maze";
      } else if (hop % 2 === 0) {
        s.role = "mechanism_hub";
        s.hasMechanismHub = true;
      } else {
        s.role = "elite_landmark";
        s.hasLandmark = true;
      }
    }
  }

  return {
    cols,
    rows,
    sectorSize,
    sectors,
    entrySectorId,
    bossArenaSectorId,
    bossAntechamberSectorId,
    hopDistances,
  };
}

/**
 * Tests whether tile coordinate (i, j) is inside an anti-skip exclusion zone
 * (boss arena, boss antechamber, or within BOSS_EXCLUSION_RADIUS_TILES of boss/stairs).
 */
export function isAntiSkipTile(
  graph: SectorGraph,
  i: number,
  j: number,
  stairsTile?: TilePos,
): boolean {
  const sId = sectorIdForTile(i, j, graph.cols, graph.sectorSize);
  if (sId === graph.bossArenaSectorId || sId === graph.bossAntechamberSectorId) {
    return true;
  }
  if (stairsTile) {
    const d = Math.hypot(i - stairsTile.i, j - stairsTile.j);
    if (d < BOSS_EXCLUSION_RADIUS_TILES) {
      return true;
    }
  }
  return false;
}
