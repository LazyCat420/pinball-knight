/**
 * Pre-Carve SectorPlan & Mission Graph Generator
 *
 * Implements Phase 1 of Hierarchical Floor Authoring:
 * Generates an abstract topological mission/sector graph BEFORE local geometry
 * or corridors are carved. Encodes critical paths, optional loops, sector roles,
 * gateway apertures, and local deterministic seeds.
 */
import type { FloorSpec } from "../spec/floor-spec";
import { biomeFor } from "../../boot/biomes";
import type {
  PlannedGateway,
  PlannedSector,
  PlannedSectorRole,
  SectorContentBudget,
  SectorPlan,
} from "./sector-types";

/**
 * 32-bit integer mixing hash (FNV-1a based).
 * Fully deterministic across all platforms and V8/Node runtimes.
 */
export function hash32(...words: number[]): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < words.length; i++) {
    h ^= words[i] | 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

const ROLE_INDEX_MAP: Record<PlannedSectorRole, number> = {
  entry: 0,
  exploration: 1,
  mechanism_hub: 2,
  elite_landmark: 3,
  vault: 4,
  rest: 5,
  boss_antechamber: 6,
  boss_arena: 7,
};

function defaultBudgetForRole(role: PlannedSectorRole): SectorContentBudget {
  switch (role) {
    case "entry":
      return { maxEnemies: 2, maxHazards: 0, targetMechanisms: 1, hasElite: false, hasVault: false };
    case "mechanism_hub":
      return { maxEnemies: 4, maxHazards: 2, targetMechanisms: 4, hasElite: false, hasVault: false };
    case "elite_landmark":
      return { maxEnemies: 8, maxHazards: 4, targetMechanisms: 1, hasElite: true, hasVault: false };
    case "vault":
      return { maxEnemies: 3, maxHazards: 4, targetMechanisms: 1, hasElite: false, hasVault: true };
    case "boss_antechamber":
      return { maxEnemies: 4, maxHazards: 1, targetMechanisms: 0, hasElite: false, hasVault: false };
    case "boss_arena":
      return { maxEnemies: 0, maxHazards: 0, targetMechanisms: 0, hasElite: false, hasVault: false };
    case "rest":
      return { maxEnemies: 1, maxHazards: 0, targetMechanisms: 1, hasElite: false, hasVault: false };
    case "exploration":
    default:
      return { maxEnemies: 6, maxHazards: 3, targetMechanisms: 2, hasElite: false, hasVault: false };
  }
}

/**
 * Generates an authoritative pre-carve SectorPlan for the given FloorSpec.
 */
export function generateSectorPlan(spec: FloorSpec): SectorPlan {
  const cols = Math.max(1, spec.sectorsX);
  const rows = Math.max(1, spec.sectorsY);
  const totalSectors = cols * rows;

  const planRng = () => {
    let s = hash32(spec.runSeed, spec.level, spec.generatorRevision, 0x5ec701);
    return () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const rng = planRng();

  // ── 1. Single Sector Degeneracy (e.g. tiny test grid) ──────────────────
  if (totalSectors <= 1) {
    const s0: PlannedSector = {
      id: 0,
      col: 0,
      row: 0,
      role: "entry",
      biome: biomeFor(spec.level).name,
      localSeed: hash32(spec.runSeed, spec.level, spec.generatorRevision, 0, 0, 0),
      incomingGateways: [],
      outgoingGateways: [],
      contentBudget: defaultBudgetForRole("entry"),
    };
    return {
      cols: 1,
      rows: 1,
      startSectorId: 0,
      bossSectorId: 0,
      criticalPath: [0],
      optionalLoops: [],
      gateways: [],
      sectors: [s0],
    };
  }

  // ── 2. Determine Start and Boss Endpoints ──────────────────────────────
  const startCol = 0;
  const startRow = 0;
  const startSectorId = 0;

  const bossCol = cols - 1;
  const bossRow = rows - 1;
  const bossSectorId = bossRow * cols + bossCol;

  // ── 3. Critical Path Generation ────────────────────────────────────────
  // Walk from start (0,0) to boss (cols-1, rows-1) on 2D grid
  const criticalPath: number[] = [startSectorId];
  let curCol = startCol;
  let curRow = startRow;

  while (curCol !== bossCol || curRow !== bossRow) {
    const canMoveCol = curCol < bossCol;
    const canMoveRow = curRow < bossRow;

    if (canMoveCol && canMoveRow) {
      if (rng() < 0.5) curCol++;
      else curRow++;
    } else if (canMoveCol) {
      curCol++;
    } else {
      curRow++;
    }
    criticalPath.push(curRow * cols + curCol);
  }

  // Ensure critical path crosses at least minCriticalPathSectors by winding if needed
  const minCrit = Math.min(totalSectors, spec.sectorPolicy.minCriticalPathSectors);
  if (criticalPath.length < minCrit && cols >= 2 && rows >= 2) {
    // If straight diagonal was too short for the required policy, extend into an S-curve
    const detour = (startRow + 1) * cols + startCol;
    if (!criticalPath.includes(detour) && detour < totalSectors) {
      criticalPath.splice(1, 0, detour);
    }
  }

  const criticalSet = new Set(criticalPath);

  // ── 4. Sector Role Assignment ──────────────────────────────────────────
  const sectorRoles = new Map<number, PlannedSectorRole>();
  sectorRoles.set(startSectorId, "entry");
  sectorRoles.set(bossSectorId, "boss_arena");

  if (criticalPath.length >= 2) {
    const antechamberId = criticalPath[criticalPath.length - 2];
    sectorRoles.set(antechamberId, "boss_antechamber");
  }

  // Assign intermediate critical path roles based on mission template
  for (let idx = 1; idx < criticalPath.length - 2; idx++) {
    const sid = criticalPath[idx];
    if (spec.missionTemplate === "mechanism_gauntlet") {
      sectorRoles.set(sid, idx % 2 === 0 ? "mechanism_hub" : "exploration");
    } else if (spec.missionTemplate === "branching_hunt") {
      sectorRoles.set(sid, idx === 1 ? "elite_landmark" : "exploration");
    } else {
      sectorRoles.set(sid, "exploration");
    }
  }

  // ── 5. Optional Loops & Side Sectors ───────────────────────────────────
  const optionalLoops: number[][] = [];
  const visited = new Set<number>(criticalPath);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const sid = r * cols + c;
      if (visited.has(sid)) continue;

      // Find neighbor that is already in critical path
      const neighbors: number[] = [];
      if (c > 0) neighbors.push(r * cols + (c - 1));
      if (c < cols - 1) neighbors.push(r * cols + (c + 1));
      if (r > 0) neighbors.push((r - 1) * cols + c);
      if (r < rows - 1) neighbors.push((r + 1) * cols + c);

      const parentCrit = neighbors.find((n) => criticalSet.has(n));
      if (parentCrit !== undefined) {
        visited.add(sid);
        const loopRole: PlannedSectorRole =
          spec.missionTemplate === "locked_vault" ? "vault" :
          spec.missionTemplate === "mechanism_gauntlet" ? "mechanism_hub" :
          rng() < 0.3 ? "elite_landmark" : "exploration";

        sectorRoles.set(sid, loopRole);
        optionalLoops.push([parentCrit, sid, parentCrit]);
      } else {
        visited.add(sid);
        sectorRoles.set(sid, "exploration");
      }
    }
  }

  // ── 6. Gateway Generation between Linked Sectors ───────────────────────
  const gateways: PlannedGateway[] = [];
  const sectorGateways = new Map<number, { inc: PlannedGateway[]; out: PlannedGateway[] }>();

  for (let sid = 0; sid < totalSectors; sid++) {
    sectorGateways.set(sid, { inc: [], out: [] });
  }

  function addPlannedGateway(from: number, to: number, locked = false) {
    const fromCol = from % cols;
    const fromRow = Math.floor(from / cols);
    const toCol = to % cols;
    const toRow = Math.floor(to / cols);

    let edge: "N" | "S" | "E" | "W" = "E";
    if (toCol > fromCol) edge = "E";
    else if (toCol < fromCol) edge = "W";
    else if (toRow > fromRow) edge = "S";
    else if (toRow < fromRow) edge = "N";

    const gwId = `gw_${from}_${to}`;
    const gw: PlannedGateway = {
      id: gwId,
      fromSectorId: from,
      toSectorId: to,
      edge,
      tileOffset: Math.floor(spec.sectorPolicy.sizeTiles / 2),
      locked,
    };
    gateways.push(gw);
    sectorGateways.get(from)?.out.push(gw);

    // Complementary reverse edge
    let oppEdge: "N" | "S" | "E" | "W" = "W";
    if (edge === "E") oppEdge = "W";
    else if (edge === "W") oppEdge = "E";
    else if (edge === "S") oppEdge = "N";
    else if (edge === "N") oppEdge = "S";

    const revGw: PlannedGateway = {
      id: `gw_${to}_${from}`,
      fromSectorId: to,
      toSectorId: from,
      edge: oppEdge,
      tileOffset: Math.floor(spec.sectorPolicy.sizeTiles / 2),
      locked,
    };
    sectorGateways.get(to)?.inc.push(revGw);
  }

  // Connect critical path sectors sequentially
  for (let i = 0; i < criticalPath.length - 1; i++) {
    addPlannedGateway(criticalPath[i], criticalPath[i + 1]);
  }

  // Connect optional loops
  for (const loop of optionalLoops) {
    if (loop.length >= 2) {
      const isVault = sectorRoles.get(loop[1]) === "vault";
      addPlannedGateway(loop[0], loop[1], isVault);
    }
  }

  // Ensure all remaining adjacent grid sectors have basic gateway connectivity
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const sid = r * cols + c;
      const gws = sectorGateways.get(sid);
      if (gws && gws.inc.length === 0 && gws.out.length === 0) {
        // Find adjacent neighbor and connect
        if (c > 0) addPlannedGateway(sid, r * cols + (c - 1));
        else if (r > 0) addPlannedGateway(sid, (r - 1) * cols + c);
      }
    }
  }

  // ── 7. Build PlannedSector Records ─────────────────────────────────────
  const sectors: PlannedSector[] = [];
  for (let sid = 0; sid < totalSectors; sid++) {
    const col = sid % cols;
    const row = Math.floor(sid / cols);
    const role = sectorRoles.get(sid) ?? "exploration";
    const roleIndex = ROLE_INDEX_MAP[role] ?? 1;
    const localSeed = hash32(spec.runSeed, spec.level, spec.generatorRevision, col, row, roleIndex);
    const gws = sectorGateways.get(sid) ?? { inc: [], out: [] };

    sectors.push({
      id: sid,
      col,
      row,
      role,
      biome: biomeFor(spec.level).name,
      localSeed,
      incomingGateways: gws.inc,
      outgoingGateways: gws.out,
      contentBudget: defaultBudgetForRole(role),
    });
  }

  return {
    cols,
    rows,
    startSectorId,
    bossSectorId,
    criticalPath,
    optionalLoops,
    gateways,
    sectors,
  };
}
