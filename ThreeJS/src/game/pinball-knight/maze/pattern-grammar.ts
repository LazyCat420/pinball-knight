/**
 * PATTERN GRAMMAR — Structural wall and floor pattern classification for the maze.
 *
 * Establishes an architectural grammar over the tile grid so that:
 * 1. Corner parts (deflectors, corner boosters) ONLY spawn in validated corner slots,
 *    never in the middle of a straight wall.
 * 2. Straight launchers and booster highways ONLY spawn in verified straight runs or
 *    open arenas with >= 3 tiles of unobstructed runway.
 * 3. Threshold clearways (room doorways, chute merges, stair approaches) are protected
 *    with a strict clearance zone so the ball and player never get wedged or trapped.
 *
 * DOM- and three-free. Pure functions over Grid.
 */
import { type Grid, at, idx, isWalkable, T_FLOOR, T_WALL, T_STAIRS, T_CRACKED } from "./generator";
import { type Doorway, doorwayFootprint } from "./doorways";

export type FloorSlotType =
  | "straight_3wide"
  | "corner_inner"
  | "corner_outer"
  | "junction"
  | "deadend"
  | "threshold_clearway"
  | "open_arena"
  | "unclassified";

export type WallSlotType =
  | "wall_straight"
  | "wall_corner_convex"
  | "wall_corner_concave"
  | "wall_pillar"
  | "wall_interior";

export interface PatternSlot {
  slotType: FloorSlotType;
  wallType?: WallSlotType;
  /** Primary alignment or exit direction [di, dj]. */
  dirI: number;
  dirJ: number;
  /** Secondary alignment direction [dir2I, dir2J] for corners/turns. */
  dir2I: number;
  dir2J: number;
  /** Corridor width at this tile (1, 2, 3+). */
  width: number;
  /** Is this tile within a protected threshold clearway? */
  isClearway: boolean;
}

export interface PatternGrammarGrid {
  w: number;
  h: number;
  slots: PatternSlot[];
  getSlot(i: number, j: number): PatternSlot;
}

/** Check if a tile is walkable floor or stairs. */
function openTile(g: Grid, i: number, j: number): boolean {
  if (i < 0 || j < 0 || i >= g.w || j >= g.h) return false;
  const t = at(g, i, j);
  return t === T_FLOOR || t === T_STAIRS;
}

/** Check if a tile is solid wall stone. */
function wallTile(g: Grid, i: number, j: number): boolean {
  if (i < 0 || j < 0 || i >= g.w || j >= g.h) return true;
  return !openTile(g, i, j);
}

/** Classify a wall tile's architectural shape. */
export function classifyWallSlot(g: Grid, i: number, j: number): WallSlotType {
  if (openTile(g, i, j)) return "wall_interior";
  const N = openTile(g, i, j - 1);
  const S = openTile(g, i, j + 1);
  const E = openTile(g, i + 1, j);
  const W = openTile(g, i - 1, j);
  const openCount = (N ? 1 : 0) + (S ? 1 : 0) + (E ? 1 : 0) + (W ? 1 : 0);

  if (openCount === 0) return "wall_interior";
  if (openCount >= 3) return "wall_pillar";
  if (openCount === 1) return "wall_straight";

  // Two open orthogonal neighbors
  if ((N && S) || (E && W)) {
    return "wall_straight"; // thin partition between two passages
  }

  // Adjacent open neighbors (e.g. N and E open) -> convex corner tip
  return "wall_corner_convex";
}

/** Measure the continuous open span across a given axis at (i, j). */
function measureSpan(g: Grid, i: number, j: number, axisI: number, axisJ: number): number {
  let count = 1;
  // Positive direction
  let step = 1;
  while (openTile(g, i + axisI * step, j + axisJ * step)) {
    count++;
    step++;
  }
  // Negative direction
  step = 1;
  while (openTile(g, i - axisI * step, j - axisJ * step)) {
    count++;
    step++;
  }
  return count;
}

/**
 * Builds the complete PatternGrammarGrid for the maze.
 */
export function analyzePatternGrammar(
  g: Grid,
  doorways: Doorway[] = [],
  rooms: Array<{ i0: number; j0: number; w: number; h: number }> = [],
): PatternGrammarGrid {
  const slots: PatternSlot[] = new Array(g.w * g.h);

  // Mark doorway / threshold clearways (tiles within doorway footprints + 1-tile margin)
  const clearwayMask = new Uint8Array(g.w * g.h);
  for (const d of doorways) {
    const fp = doorwayFootprint(g, d);
    for (const t of fp) {
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const tx = t.i + di;
          const ty = t.j + dj;
          if (tx >= 0 && tx < g.w && ty >= 0 && ty < g.h) {
            clearwayMask[idx(g, tx, ty)] = 1;
          }
        }
      }
    }
  }

  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      const k = idx(g, i, j);
      const isFloor = openTile(g, i, j);

      if (!isFloor) {
        slots[k] = {
          slotType: "unclassified",
          wallType: classifyWallSlot(g, i, j),
          dirI: 0,
          dirJ: 0,
          dir2I: 0,
          dir2J: 0,
          width: 0,
          isClearway: false,
        };
        continue;
      }

      const isClearway = clearwayMask[k] === 1;
      const inRoom = rooms.some(
        (r) => i >= r.i0 + 1 && i < r.i0 + r.w - 1 && j >= r.j0 + 1 && j < r.j0 + r.h - 1,
      );

      const N = openTile(g, i, j - 1);
      const S = openTile(g, i, j + 1);
      const E = openTile(g, i + 1, j);
      const W = openTile(g, i - 1, j);
      const openCount = (N ? 1 : 0) + (S ? 1 : 0) + (E ? 1 : 0) + (W ? 1 : 0);

      // 1. Clearway priority
      if (isClearway) {
        slots[k] = {
          slotType: "threshold_clearway",
          dirI: E ? 1 : W ? -1 : 0,
          dirJ: S ? 1 : N ? -1 : 0,
          dir2I: 0,
          dir2J: 0,
          width: Math.max(measureSpan(g, i, j, 1, 0), measureSpan(g, i, j, 0, 1)),
          isClearway: true,
        };
        continue;
      }

      // 2. Open Arena Room Interior
      if (inRoom && openCount === 4) {
        slots[k] = {
          slotType: "open_arena",
          dirI: 0,
          dirJ: 0,
          dir2I: 0,
          dir2J: 0,
          width: Math.max(measureSpan(g, i, j, 1, 0), measureSpan(g, i, j, 0, 1)),
          isClearway: false,
        };
        continue;
      }

      // 3. Dead End (1 open neighbor)
      if (openCount === 1) {
        const dirI = E ? 1 : W ? -1 : 0;
        const dirJ = S ? 1 : N ? -1 : 0;
        slots[k] = {
          slotType: "deadend",
          dirI,
          dirJ,
          dir2I: 0,
          dir2J: 0,
          width: 1,
          isClearway: false,
        };
        continue;
      }

      // 4. Straight Corridor (2 opposite neighbors: N+S or E+W)
      if ((N && S && !E && !W) || (E && W && !N && !S)) {
        const isHoriz = E && W;
        const width = isHoriz ? measureSpan(g, i, j, 0, 1) : measureSpan(g, i, j, 1, 0);
        slots[k] = {
          slotType: "straight_3wide",
          dirI: isHoriz ? 1 : 0,
          dirJ: isHoriz ? 0 : 1,
          dir2I: isHoriz ? -1 : 0,
          dir2J: isHoriz ? 0 : -1,
          width,
          isClearway: false,
        };
        continue;
      }

      // 5. 90-degree Corner (2 perpendicular neighbors: e.g. S+E, S+W, N+E, N+W)
      if (openCount === 2) {
        const dirI = E ? 1 : W ? -1 : 0;
        const dirJ = S ? 1 : N ? -1 : 0;
        // Inner crook check: diagonal opposite to corner legs should be solid wall
        const diagI = i - dirI;
        const diagJ = j - dirJ;
        const isInner = wallTile(g, diagI, diagJ);

        slots[k] = {
          slotType: isInner ? "corner_inner" : "corner_outer",
          dirI,
          dirJ: 0,
          dir2I: 0,
          dir2J: dirJ,
          width: Math.min(measureSpan(g, i, j, 1, 0), measureSpan(g, i, j, 0, 1)),
          isClearway: false,
        };
        continue;
      }

      // 6. Junction (3 or 4 open neighbors)
      slots[k] = {
        slotType: "junction",
        dirI: 0,
        dirJ: 0,
        dir2I: 0,
        dir2J: 0,
        width: Math.max(measureSpan(g, i, j, 1, 0), measureSpan(g, i, j, 0, 1)),
        isClearway: false,
      };
    }
  }

  return {
    w: g.w,
    h: g.h,
    slots,
    getSlot(i: number, j: number): PatternSlot {
      if (i < 0 || j < 0 || i >= g.w || j >= g.h) {
        return {
          slotType: "unclassified",
          wallType: "wall_interior",
          dirI: 0,
          dirJ: 0,
          dir2I: 0,
          dir2J: 0,
          width: 0,
          isClearway: false,
        };
      }
      return slots[idx(g, i, j)];
    },
  };
}

/**
 * Validates if a pinball component kind is topologically legal in a given slot type.
 * Enforces the core invariant: Corner parts (deflector, boostcorner) CANNOT render
 * in the middle of a straight wall or corridor.
 */
export function isLegalSlotForPart(kind: string, slotType: FloorSlotType): boolean {
  // Clearway threshold zones reject obstructive furniture
  if (slotType === "threshold_clearway") {
    return false;
  }

  switch (kind) {
    case "deflector":
    case "boostcorner":
      // Corner parts must ONLY land on genuine inner corners or room corner bends
      return slotType === "corner_inner";

    case "booster":
    case "ramp":
    case "jumppad":
      // Linear launchers must land on straight runs, open arenas, or junctions with clear runway
      return slotType === "straight_3wide" || slotType === "open_arena" || slotType === "junction";

    case "spring":
      // Springs belong in dead ends or terminus pockets
      return slotType === "deadend" || slotType === "corner_inner";

    case "bumper":
    case "spinpad":
    case "magpost":
      // Omnidirectional bounce/hazard parts thrive in junctions, open arenas, and wide corridors
      return slotType === "junction" || slotType === "open_arena" || slotType === "straight_3wide";

    case "flipper":
    case "slingshot":
      // Mechanical side-kickers want junctions, corners, or wide corridors
      return slotType === "junction" || slotType === "corner_inner" || slotType === "straight_3wide" || slotType === "open_arena";

    default:
      return true;
  }
}
