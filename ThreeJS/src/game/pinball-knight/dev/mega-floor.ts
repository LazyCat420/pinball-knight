/**
 * THE MEGA FLOOR — one floor, many times larger than any the game ships, built
 * so the generator's VOCABULARY is visible in a single picture.
 *
 * ── Why a big floor rather than more floors ────────────────────────────────
 *
 * The complaint this exists to serve is about repetition: "it's just random
 * walls being jumbled together". That is a claim about the DISTRIBUTION of
 * motifs, and a shipped floor is too small a sample to see one. At the cap
 * (`levelConfig` saturates at 96x72 cells = 193x145 tiles, L23/24 — see
 * [[there-are-no-levels-only-five-archetypes]]) a floor carries a few hundred
 * parts and maybe forty curves. Enough to play; not enough to tell "the
 * generator has six ideas" from "this seed drew six of its forty ideas".
 *
 * A contact sheet of sixty small floors is the obvious alternative, and it is
 * strictly worse for this question: each floor re-rolls the track graph, so
 * cross-floor repetition is confounded with the archetype's own layout. One
 * floor, one rng stream, 10x the area puts every motif the generator can emit
 * side by side under identical conditions.
 *
 * ── What this is NOT ───────────────────────────────────────────────────────
 *
 * Not a game mode, and not a floor anybody plays. It is oversized on purpose
 * and nothing gates it — no route check that matters at this scale, no boss
 * seat, no descent. Treat every number it reports as a statement about the
 * generator, not about a floor a player will meet.
 *
 * ── Faithfulness: the one rule ─────────────────────────────────────────────
 *
 * `spawn/floor-authoring.ts authorFloor` states it — "THE ORDER OF THE DRAWS IS
 * THE CONTRACT" — and this used to mirror it draw for draw, as a SECOND
 * transcription sitting beside `dev/headless-floor.ts buildHeadlessPlan`.
 *
 * ⚠️ THAT IS EXACTLY THE SHAPE THAT DRIFTS, AND IT DID. On 2026-09-06 the
 * headless harness was fixed to pass `track.chambers` and `track.doorways` and
 * to run `authorLampPuzzle`, all three of which `authorFloor` does. This file
 * was not touched, so it kept building the older, wrong floor — and its own
 * anti-drift gate caught it on three missing braziers. A copy that has to be
 * updated in lockstep is a copy that will not be.
 *
 * So there is no transcription here any more. `authorHeadlessPlan` owns the
 * draw order, and this module contributes only the two things that are actually
 * its own: an UNCLAMPED grid size (a parameter, rather than an edit to
 * `levelConfig`, so the shipping table is untouched) and the density
 * re-inflation below. Both are options on that one function, so the next stage
 * `authorFloor` grows is added once and both harnesses get it.
 *
 * ── Density, and why `raw` is the wrong default ────────────────────────────
 *
 * `partsArea = walkable / 600` scales with area, but the level term
 * (`PARTS_BASE + (level-1)*PARTS_PER_LEVEL`, capped at `PARTS_MAX`) does not.
 * On a 10x floor the level term is diluted 10x, so a `raw` mega floor is
 * MEASURABLY SPARSER than the floor it is supposed to represent — and a
 * sparser floor has fewer motifs per unit area, which would flatter the very
 * statistic this tool exists to measure. `shipped` (the default) computes the
 * reference floor's parts-per-walkable at the same level and applies that
 * ratio, so texture is preserved and the picture is honest.
 *
 * DOM- and three-free, like the rest of the maze layer: this runs in node.
 */
import { authorHeadlessPlan } from "./headless-floor";
import { levelConfig } from "../constants";
import type { Grid, TilePos } from "../maze/generator";
import type { LevelPlan } from "../maze/decorate";
import type { Doorway } from "../maze/doorways";

export interface MegaFloorOptions {
  /**
   * Which row of the three data tables to build from. Depth is not difficulty
   * here — it picks the archetype (`(level-1) % 5`), the theme, and the budget
   * row. 5 is the default for the same reason `__ghost()` uses it: the
   * shallowest depth with the whole roster unlocked.
   */
  level?: number;
  runSeed?: number;
  /** Grid size in CELLS. The shipped cap is 96x72; anything is legal here. */
  cellsW?: number;
  cellsH?: number;
  /** Multiple of THIS LEVEL's shipped cell grid, when cellsW/H are not given. */
  scale?: number;
  /**
   * `shipped` (default) holds parts-per-walkable at the reference floor's
   * value. `raw` uses the budget formula unmodified — useful exactly once, to
   * show how much the flat terms dilute. See the header.
   */
  density?: "shipped" | "raw";
  /** Author a guaranteed vault, as a grade-S descent does. */
  bonusRoom?: boolean;
}

export interface MegaFloor {
  grid: Grid;
  start: TilePos;
  stairs: TilePos;
  doorways: Doorway[];
  plan: LevelPlan;
  archetype: string;
  theme: string;
  modifier: string;
  level: number;
  runSeed: number;
  cellsW: number;
  cellsH: number;
  walkable: number;
  relaxed: string[];
  /** Walkable tiles on this floor / walkable tiles on the reference floor. */
  areaRatio: number;
  /** The part budget actually handed to `decorateMaze`, after density scaling. */
  partBudget: number;
  /** Wall-clock of the two heavy stages, in ms. The generator is superlinear. */
  timing: { track: number; decorate: number };
}

export function buildMegaFloor(opts: MegaFloorOptions = {}): MegaFloor | null {
  const level = opts.level ?? 5;
  const runSeed = opts.runSeed ?? 0x6057;
  const cfg = levelConfig(level);
  const scale = opts.scale ?? 3;
  const f = authorHeadlessPlan({
    level,
    runSeed,
    cellsW: opts.cellsW ?? Math.round(cfg.cellsW * scale),
    cellsH: opts.cellsH ?? Math.round(cfg.cellsH * scale),
    density: opts.density ?? "shipped",
    bonusRoom: opts.bonusRoom ?? false,
  });
  if (!f) return null;
  return {
    grid: f.grid,
    start: f.start,
    stairs: f.stairs,
    doorways: f.doorways,
    plan: f.plan,
    archetype: f.archetype,
    theme: f.theme,
    modifier: f.modifier,
    level: f.level,
    runSeed: f.runSeed,
    cellsW: f.cellsW,
    cellsH: f.cellsH,
    walkable: f.walkable,
    relaxed: f.relaxed,
    areaRatio: f.areaRatio,
    partBudget: f.partBudget,
    timing: f.timing,
  };
}
