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

export interface PlannedGateway {
  id: string;
  fromSectorId: number;
  toSectorId: number;
  edge: "N" | "S" | "E" | "W";
  tileOffset: number;
  locked?: boolean;
  keyRequired?: string;
}

export interface SectorContentBudget {
  maxEnemies: number;
  maxHazards: number;
  targetMechanisms: number;
  hasElite: boolean;
  hasVault: boolean;
}

export type PlannedSectorRole =
  | "entry"
  | "exploration"
  | "mechanism_hub"
  | "elite_landmark"
  | "vault"
  | "rest"
  | "boss_antechamber"
  | "boss_arena";

export interface PlannedSector {
  id: number;
  col: number;
  row: number;
  role: PlannedSectorRole;
  biome: string;
  localSeed: number;
  incomingGateways: PlannedGateway[];
  outgoingGateways: PlannedGateway[];
  contentBudget: SectorContentBudget;
}

export interface SectorPlan {
  cols: number;
  rows: number;
  startSectorId: number;
  bossSectorId: number;
  criticalPath: number[];
  optionalLoops: number[][];
  gateways: PlannedGateway[];
  sectors: PlannedSector[];
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

