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
 * ⚠️ BOTH WERE WRONG UNTIL 2026-07-31, in the same way and for the same reason.
 * This function ran an entire LEGACY maze — `generateMaze`, `carveRooms`,
 * `stampLandmark`, `pickFocusCells`, `stampPrefabs`, `crackSecretWalls` —
 * before `buildTrackFloor`. On the track branch, which ships and which
 * `buildTrackFloor` has declined 0 times in 400 measured floors, none of those
 * calls happen: that block is `authorFloor`'s `else`. Every one drew from the
 * shared rng, so the floor built afterwards was not the floor the game builds.
 * Measured over 15 (level, seed) pairs, the two chains agreed on **0 of 15**.
 * The shipped order is `floorRng -> rollModifier -> windinessFor ->
 * buildTrackFloor`, and that is now what this does.
 *
 * The distinction that matters — and the scar it comes from — is recorded on
 * `maze/floor-pipeline.test.ts`: a harness that RE-IMPLEMENTS the pipeline
 * drifts, and drifts in exactly the direction that hides the bug (that one went
 * three tunings stale while testing a floor nobody had shipped in months).
 * Calling the shipped function is the opposite of that.
 */
import { type Grid, type TilePos } from "../maze/generator";
import { themeFor } from "../maze/prefabs";
import { archetypeFor, windinessFor } from "../maze/archetypes";
import { buildTrackFloor } from "../maze/track-floor";
import { floorRng, floorSeed } from "../maze/floor-seed";
import { rollModifier } from "../maze/modifiers";
import { decorateMaze, type LevelPlan } from "../maze/decorate";
import { walkableCount } from "../maze/floor-metrics";
import { stampSecretBands } from "../secrets";
import { nearSealed } from "../maze/track-socket";
import { authorLampPuzzle, lampCountFor } from "../maze/lamp-puzzle";
import { nearestOpenTile } from "../maze/nearest-open-tile";
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
import type { Doorway } from "../maze/doorways";
import type { TrackMask } from "../maze/track-carve";

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

/** Build one floor exactly as `core.ts startLevel` does. Null if the generator declined. */
export function buildHeadlessFloor(
  level: number,
  runSeed: number,
  funnels = false,
  funnelTune: { throatDeg?: number; depth?: number; segments?: number } = {},
  relays = false,
): HeadlessFloor | null {
  const rng = floorRng(runSeed, level);
  const cfg = levelConfig(level);
  const arch = archetypeFor(level);
  // Draws, and `authorFloor` draws it here — see this file's header and
  // `buildHeadlessPlan` for what omitting it used to cost.
  rollModifier(level, rng);
  const windiness = windinessFor(level, arch, rng);
  const track = buildTrackFloor(cfg.cellsW, cfg.cellsH, rng, {
    profile: arch.track,
    density: Math.max(0.35, Math.min(0.85, windiness)),
    funnels,
    funnelTune,
    relays,
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
    mask: track.mask,
  };
}

/**
 * A finished floor WITH ITS CONTENT — geometry, then `decorateMaze`.
 *
 * ── Why this does not call `buildHeadlessFloor` ───────────────────────────
 *
 * Because `buildHeadlessFloor` does not build the floor the game ships, and
 * neither does the `liveFloor()` helper in `maze/floor-density.test.ts`. This
 * was measured, not assumed — a probe comparing walkable count and endpoints
 * over 15 (level, seed) pairs found the shipped chain and the
 * `buildHeadlessFloor` chain agreeing on **0 of 15**.
 *
 * `spawn/floor-authoring.ts` `authorFloor` states the contract in its own
 * header — "THE ORDER OF THE DRAWS IS THE CONTRACT" — and its order is:
 *
 *     floorRng → rollModifier → windinessFor → buildTrackFloor
 *              → stampSecretBands → decorateMaze
 *
 * `buildHeadlessFloor` inserts an entire legacy maze (`generateMaze`,
 * `carveRooms`, `stampLandmark`, `pickFocusCells`, `stampPrefabs`,
 * `crackSecretWalls`) between `windinessFor` and `buildTrackFloor`. On the
 * TRACK branch — the branch that ships, and `buildTrackFloor` has declined 0
 * times in 400 measured floors — none of those calls happen; that whole block
 * lives in `authorFloor`'s `else`. Every one of them draws from the shared rng,
 * so the track floor built afterwards is a different floor. `liveFloor` drifts
 * the other way, omitting `rollModifier` and `stampSecretBands`, which also
 * draw.
 *
 * So this function mirrors `authorFloor` draw for draw instead of reusing
 * either. It runs through `authorLampPuzzle` as well.
 *
 * ⚠️ That last pass was omitted for most of this file's life, under a comment
 * claiming it and `pruneSealedBands` "do not place parts". `authorLampPuzzle`
 * DOES place parts — `authorFloor` does `plan.parts.push(...lampPuzzlePlan.lamps)`
 * immediately after calling it — so this harness reported every floor as
 * missing its braziers, and `dev/headless-floor.test.ts` (the parity test that
 * now pins this file to the shipped path) caught it at 71 parts against 75.
 * `pruneSealedBands` genuinely places nothing and is still skipped.
 *
 * The two inputs `authorFloor` reads from live run state rather than from the
 * seed are surfaced as options, so a census can hold them fixed: `bonusRoom`
 * (a grade-S/A descent unlocks a guaranteed vault) and the run seed itself.
 */
export interface HeadlessPlan extends HeadlessFloor {
  plan: LevelPlan;
  walkable: number;
  modifier: string;
}

export function buildHeadlessPlan(level: number, runSeed: number, bonusRoom = false, wallGrammar = false): HeadlessPlan | null {
  const rng = floorRng(runSeed, level);
  const cfg = levelConfig(level);
  const arch = archetypeFor(level);
  const modifier = rollModifier(level, rng);
  const windiness = windinessFor(level, arch, rng);
  const theme = themeFor(level);
  const track = buildTrackFloor(cfg.cellsW, cfg.cellsH, rng, {
    profile: arch.track,
    density: Math.max(0.35, Math.min(0.85, windiness)),
  });
  if (!track) return null;
  const grid = track.grid;
  stampSecretBands(grid, rng, cfg.secrets, {
    avoid: (i, j) => nearSealed(grid, track.mask, i, j),
  });
  const walkable = walkableCount(grid);
  const budget = floorBudgets(level, walkable);
  const partBudget = Math.min(PARTS_BASE + (level - 1) * PARTS_PER_LEVEL, PARTS_MAX) + budget.partsArea;
  const plan = decorateMaze(
    grid,
    rng,
    Math.max(1, Math.round(budget.zombies * modifier.hordeMult)),
    Math.max(4, Math.round(budget.torches * modifier.torchMult)),
    Math.max(4, Math.round(partBudget * modifier.partMult)),
    // ROOMS. `authorFloor` passes `track.chambers` here and this passed `[]`
    // from the day `buildTrackFloor` learned to report chambers
    // (648e7c7e, Plaza A-1a) until 2026-09-06 — that commit taught the
    // SHIPPED path to hand its Great Hall plaza to the decorator and did not
    // touch this file. `furnishRooms` DRAWS from the shared rng (the
    // arena/vault coin flip and the prize `shuffled`), so on greathall floors
    // — one depth in five — an empty list did not merely omit the plaza, it
    // shifted every draw after it and built a different floor.
    //
    // The cost was not hypothetical: a census run through this harness
    // reported `plan.rooms` = 0.0 and `orbit`-tagged parts = 0.0 on every
    // floor at every depth, and the four-corner ORBIT rail ring plus
    // `shots.ts hitOrbitRail` were written up as dead code on the strength of
    // it. Measured on the SHIPPED path over the same 40 floors (depths
    // 1/3/8/13/16/18/23/24 x 5 seeds): 25 rooms on 25 floors, and 60
    // orbit-tagged rails forming complete rings on 15 of them.
    //
    // A harness that omits an input reports a confident zero for everything
    // that input feeds. Anything `authorFloor` passes, this must pass.
    track.chambers,
    {
      anchors: [],
      deal: modifier.dealBias.length ? ([...modifier.dealBias, ...theme.deal] as typeof theme.deal) : theme.deal,
      targets: TARGETS_PER_FLOOR,
      trapdoors: Math.round(TRAPDOORS_PER_FLOOR * modifier.trapdoorMult),
      vaultRamps: VAULT_RAMPS_PER_FLOOR,
      hazards: Math.round(Math.min(HAZARDS_BASE + (level - 1) * HAZARDS_PER_LEVEL, HAZARDS_MAX) * modifier.hazardMult),
      forceVault: bonusRoom,
      launchBreaks: cfg.launchBreaks,
      bonusItems: modifier.bonusItems,
      endpoints: { start: track.start, stairs: track.stairs },
      strictLaunchers: true,
      chute: track.chute ?? null,
      orbit: track.orbit ?? null,
      wallsAuthored: true,
      wallGrammar,
      floor: level,
      // MUST mirror spawn/floor-authoring.ts, or this harness measures a
      // different floor's machine layer than the one that ships.
      assemblySeed: floorSeed(runSeed, level),
      // DOORWAYS, for the same reason and with the same history: `authorFloor`
      // has passed these since 9b8cd369 and this file was not updated with it.
      // They are not decoration — `decorateMaze` feeds them straight into
      // `analyzePatternGrammar`, whose clearway mask vetoes part candidates
      // (decorate.ts:2863/2884/2974) and drives `enforceDoorwayOutflow`
      // (:3559). Unlike `rooms` this one drifts on EVERY floor, not just the
      // one archetype that carves a plaza.
      doorways: track.doorways,
    },
  );
  // ── THE LAMP PUZZLE — braziers and the sealed vault, mirroring authorFloor.
  // It draws from the shared rng and it PUSHES PARTS, so a harness that skips
  // it reports a floor with no braziers on it.
  const puzzleOccupied = new Set<string>();
  const markOcc = (t: { i: number; j: number } | null | undefined): void => {
    if (t) puzzleOccupied.add(`${t.i},${t.j}`);
  };
  markOcc(plan.start);
  markOcc(plan.stairs);
  const bossSpot = nearestOpenTile(grid, plan.stairs.i, plan.stairs.j, 2) ?? plan.stairs;
  markOcc(bossSpot);
  plan.parts.forEach(markOcc);
  plan.spawns.forEach(markOcc);
  plan.items.forEach(markOcc);
  plan.props.forEach(markOcc);
  plan.torches.forEach(markOcc);
  const lampPuzzlePlan = authorLampPuzzle(grid, plan.start, (i, j) => puzzleOccupied.has(`${i},${j}`), rng, lampCountFor(level), bossSpot);
  if (lampPuzzlePlan) {
    plan.parts.push(...lampPuzzlePlan.lamps);
    markOcc(lampPuzzlePlan.vault);
  }

  return {
    grid,
    start: track.start,
    stairs: track.stairs,
    doorways: track.doorways,
    archetype: arch.id,
    level,
    runSeed,
    relaxed: track.relaxed,
    mask: track.mask,
    plan,
    walkable,
    modifier: modifier.id,
  };
}
