/**
 * A REAL FLOOR, BUILT WITHOUT A BROWSER.
 *
 * The maze layer is DOM- and three-free by contract, so the shipping generator
 * can be called straight from node. This module is that call chain and nothing
 * else — no budget arithmetic, no re-derived constants, no local copy of what
 * `core.ts startLevel` decides. Every number it uses comes from `levelConfig`
 * and `archetypeFor`, which is what makes it safe to measure against.
 *
 * ⚠️ TWIN: `maze/floor-rules.test.ts` `floorContext()` runs the SAME chain to
 * build the floors the rule gate judges. The two must move together. If you add
 * a stage to `startLevel` that changes geometry, add it in both or the census
 * and the gate stop describing the same floor.
 *
 * The distinction that matters — and the scar it comes from — is recorded on
 * `maze/floor-pipeline.test.ts`: a harness that RE-IMPLEMENTS the pipeline
 * drifts, and drifts in exactly the direction that hides the bug (that one went
 * three tunings stale while testing a floor nobody had shipped in months).
 * Calling the shipped function is the opposite of that.
 */
import { generateMaze, carveRooms, crackSecretWalls, type Grid, type TilePos } from "../maze/generator";
import { stampPrefabs, stampLandmark, pickFocusCells, themeFor } from "../maze/prefabs";
import { archetypeFor, windinessFor } from "../maze/archetypes";
import { buildTrackFloor } from "../maze/track-floor";
import { floorRng } from "../maze/floor-seed";
import { levelConfig } from "../constants";
import type { Doorway } from "../maze/doorways";

export interface HeadlessFloor {
  grid: Grid;
  start: TilePos;
  stairs: TilePos;
  doorways: Doorway[];
  archetype: string;
  level: number;
  runSeed: number;
  relaxed: string[];
}

/** Build one floor exactly as `core.ts startLevel` does. Null if the generator declined. */
export function buildHeadlessFloor(level: number, runSeed: number): HeadlessFloor | null {
  const rng = floorRng(runSeed, level);
  const cfg = levelConfig(level);
  const arch = archetypeFor(level);
  const windiness = windinessFor(level, arch, rng);
  const raw = generateMaze(cfg.cellsW, cfg.cellsH, rng, cfg.braid * arch.braidMult, windiness, {
    seeds: arch.seeds(cfg.cellsW, cfg.cellsH, rng) ?? undefined,
    solidSeeds: arch.solid,
    braidGradient: arch.braidGradient,
  });
  carveRooms(raw, rng, cfg.rooms, 3, 6);
  const theme = themeFor(level, runSeed);
  const landmark = stampLandmark(raw, rng, theme);
  const focus = pickFocusCells(raw, rng);
  stampPrefabs(raw, rng, Math.min(3 + Math.floor((level - 1) / 2), 6), theme, landmark.claimed, focus);
  crackSecretWalls(raw, rng, cfg.secrets);
  const track = buildTrackFloor(cfg.cellsW, cfg.cellsH, rng, {
    profile: arch.track,
    density: Math.max(0.35, Math.min(0.85, windiness)),
  });
  if (!track) return null;
  return {
    grid: track.grid,
    start: track.start,
    stairs: track.stairs,
    doorways: track.doorways,
    archetype: arch.id,
    level,
    runSeed,
    relaxed: track.relaxed,
  };
}
