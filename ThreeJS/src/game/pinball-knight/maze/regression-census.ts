/**
 * REGRESSION CENSUS & FIXTURE GENERATOR (Phase 0)
 *
 * Captures comprehensive, deterministic snapshots of generated floors across
 * shallow, mid, and deep levels for all archetypes.
 *
 * Snapshots include:
 *  - Grid digest (dimensions, tile counts, shape counts, hash)
 *  - Spawn and stairs coordinates
 *  - Main route/spine geometry and distances
 *  - Placed pinball pieces and orientations
 *  - Corner piece and clustering metrics
 *  - Wall runs and fragmentation metrics
 *  - Assembly and circuit footprints
 *  - Flow graph (directed edges from launchers/kickers/rails)
 *  - Rule verification verdicts
 *  - SVG minimap render
 */
import {
  type Grid,
  type TilePos,
  at,
  idx,
  isWalkable,
  T_FLOOR,
  T_WALL,
  T_STAIRS,
  T_CRACKED,
} from "./generator";
import { SHAPE_FULL, SHAPE_ARC } from "../engine/tile-shape";
import { archetypeFor, windinessFor, ARCHETYPES } from "./archetypes";
import { buildTrackFloor, type TrackFloor } from "./track-floor";
import { decorateMaze, type LevelPlan, type PinballPartSpot } from "./decorate";
import { walkableCount } from "./floor-metrics";
import { floorRng } from "./floor-seed";
import { bfsDistances } from "../engine/flow-field";
import { checkPieces, type PieceViolation } from "./piece-rules";
import { compileWallRuns, type WallRun } from "./wall-runs";
import { analyzePatternGrammar } from "./pattern-grammar";
import { exitRay, type FlowPart } from "./flow-loops";
import {
  levelConfig,
  floorBudgets,
  PARTS_BASE,
  PARTS_PER_LEVEL,
  PARTS_MAX,
  TARGETS_PER_FLOOR,
  TRAPDOORS_PER_FLOOR,
  VAULT_RAMPS_PER_FLOOR,
  HAZARDS_BASE,
  HAZARDS_PER_LEVEL,
  HAZARDS_MAX,
} from "../constants";

export interface PinnedFloorKey {
  level: number;
  seed: number;
  archetype: string;
  depthTier: "shallow" | "mid" | "deep";
}

export const REPRESENTATIVE_MATRIX: readonly PinnedFloorKey[] = [
  { level: 1, seed: 1, archetype: "warrens", depthTier: "shallow" },
  { level: 2, seed: 1, archetype: "spine", depthTier: "shallow" },
  { level: 3, seed: 1, archetype: "greathall", depthTier: "shallow" },
  { level: 4, seed: 1, archetype: "cavern", depthTier: "shallow" },
  { level: 5, seed: 1, archetype: "ringkeep", depthTier: "shallow" },
  { level: 10, seed: 1, archetype: "sewer", depthTier: "mid" },
  { level: 14, seed: 12345, archetype: "forge", depthTier: "mid" },
  { level: 24, seed: 1, archetype: "catacomb", depthTier: "deep" },
  { level: 25, seed: 1, archetype: "grotto", depthTier: "deep" },
  { level: 26, seed: 12345, archetype: "forge", depthTier: "deep" },
  { level: 27, seed: 1, archetype: "sewer", depthTier: "deep" },
  { level: 28, seed: 1, archetype: "spire", depthTier: "deep" },
];

export interface FlowEdge {
  fromI: number;
  fromJ: number;
  toI: number;
  toJ: number;
  kind: string;
}

export interface FloorSnapshot {
  key: PinnedFloorKey;
  gridDigest: {
    w: number;
    h: number;
    floors: number;
    walls: number;
    stairs: number;
    cracked: number;
    boxes: number;
    bevels: number;
    arcs: number;
    tileHash: string;
  };
  endpoints: {
    start: TilePos;
    stairs: TilePos;
    routeDistance: number;
  };
  clusteringMetrics: {
    totalParts: number;
    partsByKind: Record<string, number>;
    partsInCorners: number;
    partsInCloseClusters: number; // parts with Chebyshev distance <= 2 to another part
  };
  wallRunMetrics: {
    totalRuns: number;
    meanLength: number;
    runsLength1or2: number;
    shapedEndsOnShortRuns: number;
  };
  assemblies: {
    hasChute: boolean;
    chuteLength?: number;
    hasOrbit: boolean;
    circuitCount: number;
  };
  parts: Array<{
    kind: string;
    i: number;
    j: number;
    dirI: number;
    dirJ: number;
    dir2I: number;
    dir2J: number;
    spine?: boolean;
    chain?: boolean;
  }>;
  flowEdges: FlowEdge[];
  violations: Array<{
    label: string;
    rule: string;
    i: number;
    j: number;
    detail: string;
  }>;
}

/** Compute a fast deterministic 32-bit FNV-1a hash of a Uint8Array */
function fnv1a(data: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Build and extract a full headless floor snapshot */
export function captureFloorSnapshot(level: number, seed: number): { snapshot: FloorSnapshot; grid: Grid } | null {
  const cfg = levelConfig(level);
  const arch = archetypeFor(level);
  const rng = floorRng(seed, level);
  const windiness = windinessFor(level, arch, rng);
  const track = buildTrackFloor(cfg.cellsW, cfg.cellsH, rng, {
    profile: arch.track,
    density: Math.max(0.35, Math.min(0.85, windiness)),
  });
  if (!track) return null;

  const grid = track.grid;
  const walkable = walkableCount(grid);
  const budget = floorBudgets(level, walkable);
  const partBudget = Math.min(PARTS_BASE + (level - 1) * PARTS_PER_LEVEL, PARTS_MAX) + budget.partsArea;

  const plan = decorateMaze(grid, rng, budget.zombies, budget.torches, partBudget, [], {
    targets: TARGETS_PER_FLOOR,
    trapdoors: TRAPDOORS_PER_FLOOR,
    vaultRamps: VAULT_RAMPS_PER_FLOOR,
    hazards: Math.min(HAZARDS_BASE + (level - 1) * HAZARDS_PER_LEVEL, HAZARDS_MAX),
    launchBreaks: cfg.launchBreaks,
    endpoints: { start: track.start, stairs: track.stairs },
    strictLaunchers: true,
    chute: track.chute ?? null,
    orbit: track.orbit ?? null,
    wallsAuthored: true,
    floor: level,
  });

  // 1. Grid digest
  let floors = 0;
  let walls = 0;
  let stairs = 0;
  let cracked = 0;
  let boxes = 0;
  let bevels = 0;
  let arcs = 0;

  const combined = new Uint8Array(grid.w * grid.h * 2);
  for (let k = 0; k < grid.w * grid.h; k++) {
    const t = grid.t[k];
    const s = grid.shapes[k];
    combined[k * 2] = t;
    combined[k * 2 + 1] = s;

    if (t === T_FLOOR) floors++;
    else if (t === T_WALL) walls++;
    else if (t === T_STAIRS) stairs++;
    else if (t === T_CRACKED) cracked++;

    if (s === SHAPE_ARC) arcs++;
    else if (s !== SHAPE_FULL) bevels++;
    else if (t === T_WALL) boxes++;
  }
  const tileHash = fnv1a(combined);

  // 2. Endpoints & Route
  const dist = bfsDistances(grid, track.start.i, track.start.j);
  const routeDistance = dist[idx(grid, track.stairs.i, track.stairs.j)];

  // 3. Pattern Grammar & Clustering Metrics
  const grammar = analyzePatternGrammar(grid, track.doorways, track.chambers);
  const partsByKind: Record<string, number> = {};
  let partsInCorners = 0;
  let partsInCloseClusters = 0;

  const parts = plan.parts.map((p) => ({
    kind: p.kind,
    i: p.i,
    j: p.j,
    dirI: p.dirI,
    dirJ: p.dirJ,
    dir2I: p.dir2I,
    dir2J: p.dir2J,
    spine: p.spine,
    chain: p.chain,
  }));

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    partsByKind[p.kind] = (partsByKind[p.kind] ?? 0) + 1;
    const slot = grammar.getSlot(p.i, p.j);
    if (slot.slotType === "corner_inner" || slot.slotType === "corner_outer") {
      partsInCorners++;
    }

    let hasCloseNeighbor = false;
    for (let j = 0; j < parts.length; j++) {
      if (i === j) continue;
      const q = parts[j];
      const chebyshev = Math.max(Math.abs(p.i - q.i), Math.abs(p.j - q.j));
      if (chebyshev <= 2) {
        hasCloseNeighbor = true;
        break;
      }
    }
    if (hasCloseNeighbor) partsInCloseClusters++;
  }

  // 4. Wall Runs & Fragmentation
  const runsResult = compileWallRuns(grid, "runs");
  let totalLength = 0;
  let runsLength1or2 = 0;
  let shapedEndsOnShortRuns = 0;

  for (const r of runsResult.runs) {
    totalLength += r.n;
    if (r.n <= 2) {
      runsLength1or2++;
      if (r.ends[0].kind === "shaped") shapedEndsOnShortRuns++;
      if (r.ends[1].kind === "shaped") shapedEndsOnShortRuns++;
    }
  }
  const meanLength = runsResult.runs.length > 0 ? totalLength / runsResult.runs.length : 0;

  // 5. Assemblies
  const assemblies = {
    hasChute: Boolean(track.chute),
    chuteLength: track.chute ? track.chute.spine.length : undefined,
    hasOrbit: Boolean(track.orbit),
    circuitCount: plan.circuits?.length ?? 0,
  };

  // 6. Flow Graph
  const flowEdges: FlowEdge[] = [];
  for (const p of parts) {
    const [di, dj] = exitRay(p as FlowPart);
    if (di === 0 && dj === 0) continue;
    // Step forward along di, dj to find target
    let step = 1;
    while (step <= 12) {
      const ti = p.i + di * step;
      const tj = p.j + dj * step;
      if (!isWalkable(grid, ti, tj) && at(grid, ti, tj) !== T_CRACKED) break;
      const hit = parts.find((q) => q.i === ti && q.j === tj);
      if (hit) {
        flowEdges.push({
          fromI: p.i,
          fromJ: p.j,
          toI: hit.i,
          toJ: hit.j,
          kind: p.kind,
        });
        break;
      }
      step++;
    }
  }

  // 7. Violations
  const violations = checkPieces(grid, track.mask, { parts: parts as FlowPart[] }).map((v) => ({
    label: v.label,
    rule: v.rule,
    i: v.i,
    j: v.j,
    detail: v.detail,
  }));

  const depthTier = level <= 5 ? "shallow" : level <= 15 ? "mid" : "deep";

  const snapshot: FloorSnapshot = {
    key: {
      level,
      seed,
      archetype: arch.id,
      depthTier,
    },
    gridDigest: {
      w: grid.w,
      h: grid.h,
      floors,
      walls,
      stairs,
      cracked,
      boxes,
      bevels,
      arcs,
      tileHash,
    },
    endpoints: {
      start: track.start,
      stairs: track.stairs,
      routeDistance,
    },
    clusteringMetrics: {
      totalParts: parts.length,
      partsByKind,
      partsInCorners,
      partsInCloseClusters,
    },
    wallRunMetrics: {
      totalRuns: runsResult.runs.length,
      meanLength: Math.round(meanLength * 100) / 100,
      runsLength1or2,
      shapedEndsOnShortRuns,
    },
    assemblies,
    parts,
    flowEdges,
    violations,
  };

  return { snapshot, grid };
}

/** Render a floor snapshot to an SVG string */
export function renderFloorSvg(snapshot: FloorSnapshot, g: Grid): string {
  const w = snapshot.gridDigest.w;
  const h = snapshot.gridDigest.h;
  const scale = 12;

  const lines: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w * scale} ${h * scale}" width="${w * scale}" height="${h * scale}">`,
    `<rect width="100%" height="100%" fill="#141419" />`,
  ];

  // Draw tiles
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const t = at(g, i, j);
      const x = i * scale;
      const y = j * scale;
      if (t === T_WALL) {
        lines.push(`<rect x="${x}" y="${y}" width="${scale}" height="${scale}" fill="#2a2d34" stroke="#1f2127" stroke-width="0.5" />`);
      } else if (t === T_FLOOR) {
        lines.push(`<rect x="${x}" y="${y}" width="${scale}" height="${scale}" fill="#404552" />`);
      } else if (t === T_STAIRS) {
        lines.push(`<rect x="${x}" y="${y}" width="${scale}" height="${scale}" fill="#e5c07b" />`);
      } else if (t === T_CRACKED) {
        lines.push(`<rect x="${x}" y="${y}" width="${scale}" height="${scale}" fill="#98c379" stroke="#61afef" stroke-width="1" />`);
      }
    }
  }

  // Draw flow edges
  for (const edge of snapshot.flowEdges) {
    const x1 = (edge.fromI + 0.5) * scale;
    const y1 = (edge.fromJ + 0.5) * scale;
    const x2 = (edge.toI + 0.5) * scale;
    const y2 = (edge.toJ + 0.5) * scale;
    lines.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#61afef" stroke-width="1.5" stroke-dasharray="3,2" opacity="0.8" />`);
  }

  // Draw parts
  for (const p of snapshot.parts) {
    const cx = (p.i + 0.5) * scale;
    const cy = (p.j + 0.5) * scale;
    let color = "#abb2bf";
    if (p.kind === "bumper") color = "#e06c75";
    else if (p.kind === "booster" || p.kind === "boostcorner") color = "#d19a66";
    else if (p.kind === "flipper") color = "#c678dd";
    else if (p.kind === "ramp") color = "#56b6c2";
    else if (p.kind === "spring") color = "#98c379";
    else if (p.kind === "deflector") color = "#e5c07b";

    lines.push(`<circle cx="${cx}" cy="${cy}" r="${scale * 0.3}" fill="${color}" />`);

    if (p.dirI !== 0 || p.dirJ !== 0) {
      const ex = cx + p.dirI * scale * 0.45;
      const ey = cy + p.dirJ * scale * 0.45;
      lines.push(`<line x1="${cx}" y1="${cy}" x2="${ex}" y2="${ey}" stroke="#ffffff" stroke-width="1.5" />`);
    }
  }

  // Start & Stairs markers
  const sx = (snapshot.endpoints.start.i + 0.5) * scale;
  const sy = (snapshot.endpoints.start.j + 0.5) * scale;
  lines.push(`<circle cx="${sx}" cy="${sy}" r="${scale * 0.4}" fill="#98c379" stroke="#ffffff" stroke-width="1" />`);

  const ex = (snapshot.endpoints.stairs.i + 0.5) * scale;
  const ey = (snapshot.endpoints.stairs.j + 0.5) * scale;
  lines.push(`<rect x="${ex - scale * 0.35}" y="${ey - scale * 0.35}" width="${scale * 0.7}" height="${scale * 0.7}" fill="#e5c07b" stroke="#ffffff" stroke-width="1" />`);

  lines.push(`</svg>`);
  return lines.join("\n");
}
