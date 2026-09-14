/**
 * ASCII / Unicode floor dump utility for terminal inspection of generated floors.
 * Pure DOM- and Three-free.
 */
import { at, idx, isWalkable, shapeAt, T_CRACKED, T_FLOOR, T_STAIRS, T_WALL, type Grid } from "./generator";
import { isRound, isSlant, SHAPE_ARC, SHAPE_ROUND_NE, SHAPE_ROUND_NW, SHAPE_ROUND_SE, SHAPE_ROUND_SW, SHAPE_SLANT_NE, SHAPE_SLANT_NW, SHAPE_SLANT_SE, SHAPE_SLANT_SW } from "../engine/tile-shape";
import { authorMaze, type FloorAuthorOptions } from "./author-floor";
import { bfsDistances } from "../engine/flow-field";
import { backedFraction } from "./arc-contract";

export interface FloorAsciiOptions {
  showParts?: boolean;
  showLane?: boolean;
  unicode?: boolean;
}

export function renderFloorAscii(
  floor: ReturnType<typeof authorMaze>,
  opts: FloorAsciiOptions = {}
): string {
  const { grid, plan, track } = floor;
  const unicode = opts.unicode ?? true;
  const showParts = opts.showParts ?? true;
  const showLane = opts.showLane ?? true;

  const partMap = new Map<number, string>();
  if (showParts && plan.parts) {
    for (const p of plan.parts) {
      const k = idx(grid, p.i, p.j);
      let ch = "*";
      if (p.kind === "bumper") ch = "O";
      else if (p.kind === "flipper") ch = "F";
      else if (p.kind === "ramp" || p.kind === "jumppad") ch = "^";
      else if (p.kind === "target") ch = "T";
      else if (p.kind === "slingshot") ch = "V";
      else if (p.kind === "booster" || p.kind === "boostcorner") ch = ">";
      else if (p.kind === "lamp") ch = "L";
      partMap.set(k, ch);
    }
  }

  const lines: string[] = [];

  for (let j = 0; j < grid.h; j++) {
    let line = "";
    for (let i = 0; i < grid.w; i++) {
      const k = idx(grid, i, j);

      // 1. Endpoints and critical landmarks
      if (i === plan.start.i && j === plan.start.j) {
        line += "S";
        continue;
      }
      if (i === plan.stairs.i && j === plan.stairs.j) {
        line += "E";
        continue;
      }
      if (track?.bossRoom && Math.hypot(i + 0.5 - track.bossRoom.ci, j + 0.5 - track.bossRoom.cj) <= 1.0) {
        line += "K";
        continue;
      }

      // 2. Doorways
      if (track?.doorways?.some((d) => d.i === i && d.j === j)) {
        line += "D";
        continue;
      }

      // 3. Placed parts
      if (partMap.has(k)) {
        line += partMap.get(k)!;
        continue;
      }

      // 4. Tiles & Shapes
      const t = at(grid, i, j);
      if (t === T_CRACKED) {
        line += "?";
        continue;
      }

      if (t === T_STAIRS) {
        line += ">";
        continue;
      }

      if (isWalkable(grid, i, j)) {
        if (showLane && track?.mask && track.mask.lane[k] === 1) {
          line += unicode ? "·" : "~";
        } else {
          line += " ";
        }
        continue;
      }

      // Wall shapes
      const sh = shapeAt(grid, i, j);
      if (sh === SHAPE_ARC) {
        line += unicode ? "⌒" : "@";
        continue;
      }

      if (sh === SHAPE_SLANT_NE || sh === SHAPE_SLANT_SW) {
        line += "/";
        continue;
      }
      if (sh === SHAPE_SLANT_NW || sh === SHAPE_SLANT_SE) {
        line += "\\";
        continue;
      }

      if (unicode) {
        if (sh === SHAPE_ROUND_NW) line += "╭";
        else if (sh === SHAPE_ROUND_NE) line += "╮";
        else if (sh === SHAPE_ROUND_SE) line += "╯";
        else if (sh === SHAPE_ROUND_SW) line += "╰";
        else line += "█";
      } else {
        if (isRound(sh) || isSlant(sh)) line += "+";
        else line += "#";
      }
    }
    lines.push(line);
  }

  return lines.join("\n");
}

export function summarizeFloor(floor: ReturnType<typeof authorMaze>): string {
  const { grid, plan, track, level, runSeed, arch, walkable } = floor;
  const d = bfsDistances(grid, plan.start.i, plan.start.j);
  const pathLen = d[idx(grid, plan.stairs.i, plan.stairs.j)];
  const euclid = Math.hypot(plan.stairs.i - plan.start.i, plan.stairs.j - plan.start.j);
  const directness = pathLen > 0 ? (euclid / pathLen).toFixed(3) : "N/A";

  const totalArcs = grid.arcs?.length ?? 0;
  let unbackedArcs = 0;
  for (const a of grid.arcs ?? []) {
    if (backedFraction(grid, a) < 0.999) unbackedArcs++;
  }

  return [
    `=== Floor L${level} Archetype: ${arch.id} (seed: ${runSeed}) ===`,
    `Grid: ${grid.w}x${grid.h} | Walkable: ${walkable} tiles | Density: ${(walkable / (grid.w * grid.h)).toFixed(3)}`,
    `Path: start=(${plan.start.i},${plan.start.j}) -> stairs=(${plan.stairs.i},${plan.stairs.j}) | PathLen: ${pathLen} | Directness: ${directness}`,
    `Arcs: ${totalArcs} total (${unbackedArcs} unbacked) | Doorways: ${track?.doorways?.length ?? 0} | Chambers: ${track?.chambers?.length ?? 0}`,
    `Relaxations: ${track?.relaxed?.length ? track.relaxed.join(", ") : "none"}`,
    `Timing: track=${floor.timing.track}ms, decorate=${floor.timing.decorate}ms`,
  ].join("\n");
}
