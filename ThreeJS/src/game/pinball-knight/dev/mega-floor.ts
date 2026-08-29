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
 * THE CONTRACT" — and this mirrors it draw for draw, exactly as
 * `dev/headless-floor.ts buildHeadlessPlan` does, because a harness that
 * re-implements the pipeline drifts in the direction that hides the bug (that
 * scar is recorded on `maze/floor-pipeline.test.ts`, and on
 * [[headless-floor-harness-builds-a-different-floor]] where a drifted harness
 * agreed with the shipped chain on 0 of 15 floors).
 *
 * The ONE deliberate deviation is the grid size, and it is a parameter rather
 * than an edit to `levelConfig` so the shipping table is untouched. Everything
 * else — modifier, windiness, theme, secrets, budgets — comes from the same
 * functions the game calls.
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
import { themeFor } from "../maze/prefabs";
import { archetypeFor, windinessFor } from "../maze/archetypes";
import { buildTrackFloor } from "../maze/track-floor";
import { floorRng, floorSeed } from "../maze/floor-seed";
import { rollModifier } from "../maze/modifiers";
import { decorateMaze, type LevelPlan } from "../maze/decorate";
import { walkableCount } from "../maze/floor-metrics";
import { stampSecretBands } from "../secrets";
import { nearSealed } from "../maze/track-socket";
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
import type { Grid, TilePos } from "../maze/generator";
import type { Doorway } from "../maze/doorways";

/**
 * Scale factors that keep a budget's DENSITY rather than its count.
 *
 * Applied to the per-floor constants that are flat counts (`TARGETS_PER_FLOOR`
 * and friends): one drop-target bank on a floor ten times the size is not
 * "the same floor, bigger", it is a floor with one bank in a wilderness. These
 * ride the walkable ratio for the same reason the part budget does.
 */
function scaleCount(n: number, ratio: number): number {
  return Math.max(1, Math.round(n * ratio));
}

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

/**
 * The reference floor's walkable count, WITHOUT building it.
 *
 * `levelConfig.floorTiles` is the generator's own prediction (`cellsW*cellsH*2.5`,
 * documented there as ±5% typical). Using the prediction rather than building a
 * second real floor keeps this cheap and — more importantly — keeps the density
 * ratio a property of the CONFIG rather than of one reference seed's luck.
 */
function referenceWalkable(level: number): number {
  return levelConfig(level).floorTiles;
}

export function buildMegaFloor(opts: MegaFloorOptions = {}): MegaFloor | null {
  const level = opts.level ?? 5;
  const runSeed = opts.runSeed ?? 0x6057;
  const cfg = levelConfig(level);
  const scale = opts.scale ?? 3;
  const cellsW = opts.cellsW ?? Math.round(cfg.cellsW * scale);
  const cellsH = opts.cellsH ?? Math.round(cfg.cellsH * scale);
  const density = opts.density ?? "shipped";

  // ── authorFloor's draw order, from here down. Do not reorder. ────────────
  const rng = floorRng(runSeed, level);
  const arch = archetypeFor(level);
  const modifier = rollModifier(level, rng);
  const windiness = windinessFor(level, arch, rng);
  const theme = themeFor(level, runSeed);

  const t0 = Date.now();
  const track = buildTrackFloor(cellsW, cellsH, rng, {
    profile: arch.track,
    density: Math.max(0.35, Math.min(0.85, windiness)),
  });
  const trackMs = Date.now() - t0;
  if (!track) return null;

  const grid = track.grid;
  stampSecretBands(grid, rng, cfg.secrets, {
    avoid: (i, j) => nearSealed(grid, track.mask, i, j),
  });
  const walkable = walkableCount(grid);
  const areaRatio = walkable / Math.max(1, referenceWalkable(level));

  const budget = floorBudgets(level, walkable);
  const levelTerm = Math.min(PARTS_BASE + (level - 1) * PARTS_PER_LEVEL, PARTS_MAX);
  // `raw` is the shipped formula. `shipped` re-inflates the flat level term by
  // the area ratio so parts-per-walkable matches the reference floor — see the
  // header on why the flat term is the whole problem.
  const partBudgetBase = density === "raw" ? levelTerm + budget.partsArea : Math.round(levelTerm * areaRatio) + budget.partsArea;
  const partBudget = Math.max(4, Math.round(partBudgetBase * modifier.partMult));
  const ratio = density === "raw" ? 1 : areaRatio;

  const t1 = Date.now();
  const plan = decorateMaze(
    grid,
    rng,
    Math.max(1, Math.round(budget.zombies * modifier.hordeMult)),
    Math.max(4, Math.round(budget.torches * modifier.torchMult)),
    partBudget,
    [],
    {
      anchors: [],
      deal: modifier.dealBias.length ? ([...modifier.dealBias, ...theme.deal] as typeof theme.deal) : theme.deal,
      targets: scaleCount(TARGETS_PER_FLOOR, ratio),
      trapdoors: scaleCount(Math.round(TRAPDOORS_PER_FLOOR * modifier.trapdoorMult), ratio),
      vaultRamps: scaleCount(VAULT_RAMPS_PER_FLOOR, ratio),
      hazards: scaleCount(
        Math.round(Math.min(HAZARDS_BASE + (level - 1) * HAZARDS_PER_LEVEL, HAZARDS_MAX) * modifier.hazardMult),
        ratio,
      ),
      forceVault: opts.bonusRoom ?? false,
      launchBreaks: cfg.launchBreaks,
      bonusItems: modifier.bonusItems,
      endpoints: { start: track.start, stairs: track.stairs },
      strictLaunchers: true,
      chute: track.chute ?? null,
      orbit: track.orbit ?? null,
      wallsAuthored: true,
      floor: level,
      // MUST mirror spawn/floor-authoring.ts, or this harness measures a
      // different floor's machine layer than the one that ships.
      assemblySeed: floorSeed(runSeed, level),
    },
  );
  const decorateMs = Date.now() - t1;

  return {
    grid,
    start: track.start,
    stairs: track.stairs,
    doorways: track.doorways,
    plan,
    archetype: arch.id,
    theme: theme.name,
    modifier: modifier.id,
    level,
    runSeed,
    cellsW,
    cellsH,
    walkable,
    relaxed: track.relaxed,
    areaRatio,
    partBudget,
    timing: { track: trackMs, decorate: decorateMs },
  };
}
