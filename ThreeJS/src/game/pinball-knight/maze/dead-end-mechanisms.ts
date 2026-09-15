/**
 * Interactive Dead-End Mechanisms Engine
 *
 * Enforces the architectural rule that NO dead end in procedural maze generation
 * is left as an empty, boring corridor. Every dead end must carry an interactive
 * mechanism:
 *  - Hidden / cracked secret doors (shortcuts into adjacent corridors or rooms)
 *  - High ballistic catapults (flinging player over walls into distant sectors)
 *  - Heavy directional cannons (aimed down the exit runway)
 *  - Kinetic plunger springs (rebounding player at high velocity)
 *  - Trapdoors (coaster hatches / drop chutes)
 *  - Oracle Frog perches or treasure caches
 */

import {
  type Grid,
  type TilePos,
  at,
  setTile,
  isWalkable,
  T_WALL,
  T_CRACKED,
  shapeAt,
} from "./generator";
import { SHAPE_FULL } from "../engine/tile-shape";
import type { PinballPartSpot } from "./decorate";

const CARDINALS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const BAND_OFFSETS: readonly [number, number][] = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
];

export interface DeadEndSpot extends TilePos {
  /** The single open neighbor direction leading back into the maze */
  dirI: number;
  dirJ: number;
}

export interface FurnishDeadEndReport {
  totalDeadEnds: number;
  furnishedCount: number;
  unfurnishedCount: number;
  placedKinds: Record<string, number>;
  frog: TilePos | null;
}

/**
 * Find all walkable tiles on the grid that have exactly ONE walkable neighbor
 * (excluding start and stairs).
 */
export function findDeadEnds(
  g: Grid,
  start?: TilePos | null,
  stairs?: TilePos | null,
): DeadEndSpot[] {
  const deadEnds: DeadEndSpot[] = [];

  for (let j = 1; j < g.h - 1; j++) {
    for (let i = 1; i < g.w - 1; i++) {
      if (!isWalkable(g, i, j)) continue;
      if (start && i === start.i && j === start.j) continue;
      if (stairs && i === stairs.i && j === stairs.j) continue;

      let openCount = 0;
      let openDir: [number, number] = [0, 0];

      for (const [di, dj] of CARDINALS) {
        if (isWalkable(g, i + di, j + dj)) {
          openCount++;
          openDir = [di, dj];
        }
      }

      if (openCount === 1) {
        deadEnds.push({
          i,
          j,
          dirI: openDir[0],
          dirJ: openDir[1],
        });
      }
    }
  }

  return deadEnds;
}

/**
 * Determines whether a dead end possesses an interactive feature or mechanism.
 */
export function isInteractiveDeadEnd(
  g: Grid,
  spot: TilePos,
  parts: readonly PinballPartSpot[],
  secrets: readonly TilePos[] = [],
  frog: TilePos | null = null,
  items: readonly TilePos[] = [],
): boolean {
  // 1. Check if a pinball part sits on this tile
  if (parts.some((p) => p.i === spot.i && p.j === spot.j)) {
    return true;
  }

  // 2. Check if the Oracle Frog perches here
  if (frog && frog.i === spot.i && frog.j === spot.j) {
    return true;
  }

  // 3. Check if an item or treasure pickup sits here
  if (items.some((it) => it.i === spot.i && it.j === spot.j)) {
    return true;
  }

  // 4. Check if any adjacent wall is cracked (secret door / break-through)
  for (const [di, dj] of CARDINALS) {
    const ni = spot.i + di;
    const nj = spot.j + dj;
    if (at(g, ni, nj) === T_CRACKED) {
      if (spot.i === 28 && spot.j === 12) console.log('(28, 12) check 4 returned true, cracked at', ni, nj);
      return true;
    }
  }

  // 5. Check if secret band is registered adjacent
  for (const s of secrets) {
    if (
      spot.i >= s.i - 1 &&
      spot.i <= s.i + 2 &&
      spot.j >= s.j - 1 &&
      spot.j <= s.j + 2
    ) {
      if (spot.i === 28 && spot.j === 12) console.log('(28, 12) check 5 returned true, s is', s);
      return true;
    }
  }

  return false;
}

/**
 * Measure clear unobstructed floor runway in direction (di, dj).
 */
function measureRunway(g: Grid, i: number, j: number, di: number, dj: number): number {
  let step = 1;
  while (isWalkable(g, i + di * step, j + dj * step)) {
    step++;
  }
  return step - 1;
}

/**
 * Attempt to crack an even-aligned 2×2 secret band at the back of the dead end.
 */
function tryCrackDeadEnd(g: Grid, wi: number, wj: number, secrets: TilePos[]): boolean {
  const bi = wi & ~1;
  const bj = wj & ~1;
  if (bi < 2 || bj < 2 || bi + 1 > g.w - 3 || bj + 1 > g.h - 3) return false;
  for (const [ddi, ddj] of BAND_OFFSETS) {
    if (at(g, bi + ddi, bj + ddj) !== T_WALL) return false;
    if (shapeAt(g, bi + ddi, bj + ddj) !== SHAPE_FULL) return false;
  }
  for (const [ddi, ddj] of BAND_OFFSETS) {
    setTile(g, bi + ddi, bj + ddj, T_CRACKED);
  }
  secrets.push({ i: bi, j: bj });
  return true;
}

/**
 * Furnish all dead ends on the floor with interactive mechanisms.
 * 100% of dead ends will receive an engaging mechanism.
 */
export function furnishDeadEndMechanisms(
  g: Grid,
  deadEnds: readonly DeadEndSpot[],
  parts: PinballPartSpot[],
  secrets: TilePos[],
  frog: TilePos | null,
  rng: () => number,
  opts: {
    start?: TilePos | null;
    stairs?: TilePos | null;
    items?: TilePos[];
    floor?: number;
    frogAvailable?: boolean;
  } = {},
): FurnishDeadEndReport {
  const placedKinds: Record<string, number> = {};
  let currentFrog = frog;
  let furnishedCount = 0;

  for (const d of deadEnds) {
    const existingPart = parts.find((p) => p.i === d.i && p.j === d.j);
    if (existingPart) {
      existingPart.deadEnd = true;
      furnishedCount++;
      continue;
    }
    if (isInteractiveDeadEnd(g, d, parts, secrets, currentFrog, opts.items)) {
      furnishedCount++;
      continue;
    }

    const runway = measureRunway(g, d.i, d.j, d.dirI, d.dirJ);
    const backI = d.i - d.dirI;
    const backJ = d.j - d.dirJ;
    const distFromStart = opts.start ? Math.abs(d.i - opts.start.i) + Math.abs(d.j - opts.start.j) : 10;

    // ── 1. SECRET SHORTCUT: If the back wall separates this dead end from another corridor/room
    const throughWallI = d.i - d.dirI * 2;
    const throughWallJ = d.j - d.dirJ * 2;
    const canBreakThrough =
      at(g, backI, backJ) === T_WALL &&
      throughWallI >= 0 &&
      throughWallJ >= 0 &&
      throughWallI < g.w &&
      throughWallJ < g.h &&
      isWalkable(g, throughWallI, throughWallJ);

    if (canBreakThrough && rng() < 0.45 && tryCrackDeadEnd(g, backI, backJ, secrets)) {
      placedKinds.secret = (placedKinds.secret ?? 0) + 1;
      furnishedCount++;
      continue;
    }

    // ── 2. ORACLE FROG PERCH: If available and far from start
    if (!currentFrog && opts.frogAvailable && distFromStart >= 7 && rng() < 0.25) {
      currentFrog = { i: d.i, j: d.j };
      placedKinds.frog = (placedKinds.frog ?? 0) + 1;
      furnishedCount++;
      continue;
    }

    // ── 3. DIRECTIONAL CANNON (for long straight runways >= 3)
    if (runway >= 3 && rng() < 0.35) {
      parts.push({
        i: d.i,
        j: d.j,
        kind: "cannon",
        dirI: d.dirI,
        dirJ: d.dirJ,
        dir2I: 0,
        dir2J: 0,
        deadEnd: true,
      });
      placedKinds.cannon = (placedKinds.cannon ?? 0) + 1;
      furnishedCount++;
      continue;
    }

    // ── 4. KINETIC SPRING (only for long straight runways >= 3)
    if (runway >= 3 && rng() < 0.45) {
      parts.push({
        i: d.i,
        j: d.j,
        kind: "spring",
        dirI: d.dirI,
        dirJ: d.dirJ,
        dir2I: 0,
        dir2J: 0,
        deadEnd: true,
      });
      placedKinds.spring = (placedKinds.spring ?? 0) + 1;
      furnishedCount++;
      continue;
    }

    // ── 5. TRAPDOOR (coaster hatch)
    if (distFromStart >= 5 && rng() < 0.35) {
      parts.push({
        i: d.i,
        j: d.j,
        kind: "trapdoor",
        dirI: d.dirI,
        dirJ: d.dirJ,
        dir2I: 0,
        dir2J: 0,
        deadEnd: true,
      });
      placedKinds.trapdoor = (placedKinds.trapdoor ?? 0) + 1;
      furnishedCount++;
      continue;
    }

    // ── 6. HIGH-BALLISTIC CATAPULT (GUARANTEED FALLBACK)
    // Flings the player up and over walls into open territory, ideal for short runways
    parts.push({
      i: d.i,
      j: d.j,
      kind: "catapult",
      dirI: d.dirI,
      dirJ: d.dirJ,
      dir2I: 0,
      dir2J: 0,
      deadEnd: true,
    });
    placedKinds.catapult = (placedKinds.catapult ?? 0) + 1;
    furnishedCount++;
  }

  return {
    totalDeadEnds: deadEnds.length,
    furnishedCount,
    unfurnishedCount: deadEnds.length - furnishedCount,
    placedKinds,
    frog: currentFrog,
  };
}
