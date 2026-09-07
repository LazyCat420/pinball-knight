/** Validated view of the shared live author, for diagnostics and tooling. */
import { type Grid } from "./generator";
import { ARCHETYPES } from "./archetypes";
import { rollModifier } from "./modifiers";
import { type TrackFloor } from "./track-floor";
import { type LevelPlan } from "./decorate";
import { checkPieces, type PieceViolation } from "./piece-rules";
import { floorBudgets } from "../constants";
import { authorMaze } from "./author-floor";

export interface FloorProfile {
  level: number;
  seed: number;
  arch: (typeof ARCHETYPES)[number];
  modifier: ReturnType<typeof rollModifier>;
  windiness: number;
  density: number;
  walkableBudget: ReturnType<typeof floorBudgets>;
  partBudget: number;
}

export interface FloorPlanOptions {
  bonusRoom?: boolean;
  archIndex?: number;
  density?: number;
  wallGrammar?: boolean;
  strictLaunchers?: boolean;
}

export interface FloorPlan {
  profile: FloorProfile;
  track: TrackFloor;
  grid: Grid;
  plan: LevelPlan;
  violations: PieceViolation[];
  densityRepair: ReturnType<typeof authorMaze>["densityRepair"];
}


export function buildFloorPlan(level: number, seed: number, opts: FloorPlanOptions = {}): FloorPlan | null {
  const f = authorMaze({ level, runSeed: seed, bonusRoom: opts.bonusRoom,
    archIndex: opts.archIndex, trackDensity: opts.density,
    wallGrammar: opts.wallGrammar, strictLaunchers: opts.strictLaunchers });
  if (!f.track) return null;
  return {
    profile: { level, seed, arch: f.arch, modifier: f.modifier, windiness: f.windiness,
      density: f.trackDensity, walkableBudget: f.budget, partBudget: f.partBudget },
    track: f.track, grid: f.grid, plan: f.plan,
    violations: checkPieces(f.grid, f.track.mask, { parts: f.plan.parts }),
    densityRepair: f.densityRepair,
  };
}
