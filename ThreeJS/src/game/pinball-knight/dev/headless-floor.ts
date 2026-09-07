/** Headless adapters over the same author used by live play. Geometry-only
 * probes stop at authorFloorTopology; finished-floor tools call authorMaze. */
import { type Grid, type TilePos } from "../maze/generator";
import { type LevelPlan } from "../maze/decorate";
import type { Doorway } from "../maze/doorways";
import type { TrackMask } from "../maze/track-carve";
import { authorMaze, authorFloorTopology, type FloorAuthorOptions } from "../maze/author-floor";

export interface HeadlessFloor {
  grid: Grid;
  start: TilePos;
  stairs: TilePos;
  doorways: Doorway[];
  archetype: string;
  level: number;
  runSeed: number;
  relaxed: string[];
  mask?: TrackMask;
}


/** Raw track geometry only, before secret bands, content, lamps and surfaces. */
export function buildHeadlessFloor(
  level: number, runSeed: number, funnels = false,
  funnelTune: { throatDeg?: number; depth?: number; segments?: number } = {}, relays = false,
): HeadlessFloor | null {
  const { track, arch } = authorFloorTopology({ level, runSeed, funnels, funnelTune, relays });
  if (!track) return null;
  return { grid: track.grid, start: track.start, stairs: track.stairs,
    doorways: track.doorways, archetype: arch.id, level, runSeed,
    relaxed: track.relaxed, mask: track.mask };
}

export interface HeadlessPlan extends HeadlessFloor {
  plan: LevelPlan;
  walkable: number;
  modifier: string;
}
export type HeadlessAuthorOptions = FloorAuthorOptions;
export interface AuthoredHeadlessPlan extends HeadlessPlan {
  track: NonNullable<ReturnType<typeof authorMaze>["track"]>;
  theme: string;
  cellsW: number;
  cellsH: number;
  areaRatio: number;
  partBudget: number;
  timing: { track: number; decorate: number };
  densityRepair: ReturnType<typeof authorMaze>["densityRepair"];
}

export function buildHeadlessPlan(level: number, runSeed: number, bonusRoom = false, wallGrammar = true): HeadlessPlan | null {
  return authorHeadlessPlan({ level, runSeed, bonusRoom, wallGrammar });
}

/** A track census reports a declined track as null; authorMaze itself still
 * produces the live fallback, which can be inspected through that API. */
export function authorHeadlessPlan(opts: HeadlessAuthorOptions): AuthoredHeadlessPlan | null {
  const f = authorMaze(opts);
  if (!f.track) return null;
  return {
    track: f.track, grid: f.grid, start: f.plan.start, stairs: f.plan.stairs,
    doorways: f.doorways, archetype: f.arch.id, level: f.level, runSeed: f.runSeed,
    relaxed: f.track.relaxed, mask: f.track.mask, plan: f.plan, walkable: f.walkable,
    modifier: f.modifier.id, theme: f.theme.name, cellsW: f.cfg.cellsW, cellsH: f.cfg.cellsH,
    areaRatio: f.areaRatio, partBudget: f.partBudget, timing: f.timing, densityRepair: f.densityRepair,
  };
}
