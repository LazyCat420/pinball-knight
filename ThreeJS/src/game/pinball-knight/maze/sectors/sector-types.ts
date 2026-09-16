/**
 * Sector Types and Definitions for 10x Macro World Architecture
 *
 * Partitions the oversized dungeon floor into coherent macro-sectors (e.g. 32x32 tiles)
 * with designated roles, content budgets, biomes, and controlled gateway transitions.
 */
import type { TilePos } from "../generator";

export type SectorRole =
  | "entry_district"
  | "exploration_maze"
  | "mechanism_hub"
  | "elite_landmark"
  | "boss_antechamber"
  | "boss_arena"
  | "optional_loop"
  | "vault_cache";

export interface SectorBounds {
  minI: number;
  maxI: number;
  minJ: number;
  maxJ: number;
}

export interface SectorGateway {
  /** Neighbor sector id */
  targetSectorId: number;
  /** Primary doorway / transition tile in current sector */
  tile: TilePos;
  /** Gateway orientation: 'N' | 'S' | 'E' | 'W' */
  edge: "N" | "S" | "E" | "W";
  /** Is this gateway locked / guarded */
  locked?: boolean;
}

export interface SectorNode {
  id: number;
  col: number;
  row: number;
  bounds: SectorBounds;
  role: SectorRole;
  theme: string;
  gateways: SectorGateway[];
  walkableTiles: number;
  hasLandmark: boolean;
  hasMechanismHub: boolean;
}

export interface SectorGraph {
  cols: number;
  rows: number;
  sectorSize: number; // tile dimensions per sector side (default 32)
  sectors: SectorNode[];
  entrySectorId: number;
  bossArenaSectorId: number;
  bossAntechamberSectorId: number;
  /** Shortest sector hop distance from entry to each sector */
  hopDistances: number[];
}
