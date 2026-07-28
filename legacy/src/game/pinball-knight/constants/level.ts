/**
 * Per-floor scaling: grade thresholds, budgets and levelConfig. SHARED — coordinate before editing.
 *
 * Split out of the 2522-line constants.ts so parallel tracks stop colliding on
 * one file. Consumers still import from `../constants` — that barrel re-exports
 * every module here, so no call site changed.
 */
import { ROOMS_BASE, ROOMS_MAX, ROOMS_PER_LEVEL, SECRETS_BASE, SECRETS_MAX, SECRETS_PER_LEVEL } from "./maze";

// ── Floor grade + pinball style bonuses (the score glue) ────────
/**
 * Two rewards that make the machine WORTH playing like a machine:
 *  - STYLE KILLS: a kill landed while carrying pinball momentum pays bonus
 *    gold that scales with the live bounce combo — deflecting off a bumper
 *    into a zombie beats walking up and stabbing it.
 *  - FLOOR GRADE: each descent grades the floor on pace (time), carnage
 *    (horde share killed) and style (best bounce combo), S/A/B/C/D, and pays
 *    a gold bonus. The grade is the "play it again, but cooler" hook.
 */
export const STYLE_KILL_BASE_GOLD = 2; // pinball kill bonus before the combo
export const STYLE_KILL_COMBO_GOLD = 1; // +gold per live bounce-combo step…
export const STYLE_KILL_GOLD_MAX = 12; // …capped per kill
export const GRADE_TIME_FAST = 75; // seconds — under this scores full pace marks
export const GRADE_TIME_OK = 140;
export const GRADE_KILLS_FULL = 0.6; // horde share for full carnage marks
export const GRADE_KILLS_OK = 0.25;
/**
 * STYLE — the bounce-combo axis, RESCALED.
 *
 * It used to top out at 8, which is exactly `COMBO_ZONE_CRUISE`: the number
 * where the combo curve stops being a formality and the game flips into its
 * flow state. So the grade stopped measuring precisely where the interesting
 * part of the system began, and an 8× chain and an 80× chain earned identical
 * marks. The ladder now runs well past the cruise gate.
 */
export const GRADE_COMBO_FULL = 24; // best bounce combo for full style marks
export const GRADE_COMBO_OK = 8;
/**
 * FLOW — the pace axis, replacing raw wall-clock.
 *
 * Clock time graded a brisk WALK exactly like a carried line, so the one thing
 * the game is about was the one thing the grade could not see. Flow is the
 * time-weighted average of the momentum ramp across the floor (0 = walked it,
 * 1 = rode the whole thing at terminal speed). Sitting still to farm now costs
 * pace marks on its own, which is the pressure the per-floor Death Dealer
 * timer used to be carrying.
 *
 * Calibrated against real floors: a lot of any floor is unavoidably spent at
 * walking speed (fighting, looting, doorways), so 0.30 average is genuinely
 * "kept it moving" and 0.15 is "moved with purpose".
 */
export const GRADE_FLOW_FULL = 0.3;
export const GRADE_FLOW_OK = 0.15;
/** Gold paid per grade on descent, S first. */
export const GRADE_GOLD: Record<string, number> = { S: 40, A: 25, B: 15, C: 8, D: 0 };

// ── Level scaling ───────────────────────────────────────────────
// One tunable curve: maze size, horde size and zombie speed all step with depth.
/**
 * Growing-tree windiness per floor, cycled by depth so consecutive levels never
 * share a maze shape (see generateMaze): 1.0 = winding backtracker corridors,
 * 0.3 = bushy Prim's junctions, 0.65 = a mix. Level 1 stays 1.0 for continuity.
 */
export const WINDINESS_CYCLE = [1.0, 0.3, 0.65];
export interface LevelConfig {
  cellsW: number; // maze CELLS (tile grid is 2*cells+1)
  cellsH: number;
  /** ≈ walkable tiles after the 2× thicken — the area every density budget rides. */
  floorTiles: number;
  zombies: number;
  zombieSpeed: number; // tiles/sec
  torches: number;
  /** Wall-knock probability — higher = more loops/junctions = more complex. */
  braid: number;
  /**
   * Growing-tree bias in [0,1] fed to generateMaze: 1 = long winding corridors
   * (recursive backtracker), 0 = bushy many-junction maze (Prim's). Varied by
   * depth so consecutive floors read as structurally different mazes.
   */
  windiness: number;
  /** Archetype rooms carved over the corridors (bumper chamber / arena / …). */
  rooms: number;
  /** Cracked wall bands hiding shortcuts (smash at pinball speed). */
  secrets: number;
  /** A1 — extra break-through bands opened at launch-part runway ends (grow with depth). */
  launchBreaks: number;
}

/**
 * THE DENSITY BUDGETS, as a pure function of the floor's REAL walkable area.
 *
 * Split out of `levelConfig` so its two callers cannot drift apart, because they
 * genuinely need different inputs:
 *   · `levelConfig` feeds it a PREDICTION — `delve.ts floorXpIncome` projects
 *     the XP of floors that do not exist yet and cannot be handed a grid;
 *   · `core.ts buildLevel` feeds it the COUNTED walkable tiles of the grid it
 *     has just built, which is the truth.
 * Copying the arithmetic into both is how `floor-pipeline.test.ts` ended up
 * asserting against `floorTiles/32` and a cap of 60, three tunings out of date.
 *
 * ── WHY EVERY DIVISOR MOVED ───────────────────────────────────────────────
 *
 * They were all calibrated against `floorTiles`, which overstated the shipping
 * floor's walkable area by **3.2x** (measured over 64 live floors; see the note
 * on `floorTiles` below). The caps then hid it completely: at the old numbers
 * BOTH the zombie and torch caps bound from level 1 upward, so the depth ramps
 * were dead code and density FELL fourfold with depth instead of rising.
 *
 * The re-tune has one constraint beyond honesty — **the deep floors must not
 * move** — and that is achievable precisely because the caps bind there. L10+
 * zombies and L8+ torches come out bit-identical; everything shallower comes
 * down, which is where the "jumbled mess" was.
 */
export function floorBudgets(level: number, walkable: number): { zombies: number; torches: number; partsArea: number } {
  const l = Math.max(1, level);
  return {
    // /50 with a +2/level ramp. The old `/26` against a 3.2x-inflated area was
    // effectively one zombie per 8 walkable tiles, which is why it pinned the
    // cap on every floor. These numbers put the cap back to being the DRAW-CALL
    // budget its comment claims it is: it first binds at L10.
    //   L1  135 -> 50   L5  135 -> 87   L8  135 -> 121   L10+ unchanged
    zombies: Math.min(Math.round(walkable / 50) + 2 * (l - 1), 135),
    // /70 + 6. Derivation rather than taste: only TORCH_LIGHT_POOL (6) torches
    // are ever live lights and each is a radius-6 PointLight, so for N torches
    // over A walkable tiles the mean nearest-torch distance ~ 0.5*sqrt(A/N);
    // requiring that inside one light radius gives N ~ A/144 ~ 7 per 1k. /70
    // lands at ~16 per 1k — a 2x margin, which is what pays for corridors being
    // 1-D where the estimate is 2-D. Cap first binds at L8.
    torches: Math.min(Math.round(walkable / 70) + 6, 80),
    // Near-parity with the old `floorTiles/2000` (which was walkable/627 in
    // truth), and that is DELIBERATE. The corridor deal is not the density
    // problem — censused at 19-26 parts per 1k walkable and already falling
    // with depth. Moving it would re-roll every floor for no measured gain.
    partsArea: Math.floor(walkable / 600),
  };
}

export function levelConfig(level: number): LevelConfig {
  const l = Math.max(1, level);
  // Cell counts are PRE-thickenWalls: the final tile grid is (2*cells+1)*2.
  // Bigger + faster-growing than the first build so deeper floors are sprawling
  // labyrinths, not the same small maze. 4× AREA (2× per side) since the route
  // plan rework: level 1 is ~150×106 tiles; the caps let late floors reach
  // ~266×202 (~54k tiles). Counts that should ride the area do so via
  // floorTiles below; hard caps were re-tuned for the new area — see
  // ROUTE_MATH_PLAN.md §10 for what scales, what's hand-set, and the perf
  // watchlist (zombie draw calls, flow-field O(tiles)).
  const cellsW = Math.min(34 + Math.ceil(l * 2.8), 66);
  const cellsH = Math.min(24 + 2 * l, 50);
  /**
   * PREDICTED walkable tiles. A prediction, and only ever used as one — the
   * shipping path counts the real grid (`core.ts`, `walkableCount`).
   *
   * ⚠️ WAS `cellsW * cellsH * 8`, "≈ walkable tiles after the 2× scale", AND THE
   * 2x SCALE HAS NOT APPLIED SINCE TRACK-FIRST SHIPPED. The legacy branch built
   * `(2c+1)(2h+1)` and then `thickenWalls` DOUBLED each side again, so 8·c·h was
   * a fair half of ~16·c·h. `buildTrackFloor` generates at final resolution and
   * never thickens: the grid is ~4.1·c·h TOTAL, of which a measured 0.617 is
   * walkable (64 live floors) => ~2.53·c·h. The old constant was therefore
   * **3.2x too big**, and every budget riding it was calibrated against a floor
   * four times the size of the one that ships.
   *
   * 2.5 rather than 2.53 because a round number is honest about being an
   * estimate. Error against measured walkable: ±5% typical, -18% worst case on a
   * deep Warrens (openShare 0.75 there against the 0.617 mean).
   */
  const floorTiles = Math.round(cellsW * cellsH * 2.5);
  const budgets = floorBudgets(l, floorTiles);
  // Maze character cycles by depth so no two consecutive floors share a shape:
  // level 1 stays the familiar winding backtracker (1.0), then a bushy
  // junction-heavy floor (0.3), then a mixed one (0.65), repeating. Combined
  // with the rising braid, deep bushy floors become true flanking labyrinths.
  const windiness = WINDINESS_CYCLE[(l - 1) % WINDINESS_CYCLE.length];
  return {
    cellsW,
    cellsH,
    floorTiles,
    // PREDICTIONS. `core.ts` recomputes both from the finished grid; these exist
    // for `delve.ts floorXpIncome`, which projects floors that do not exist.
    zombies: budgets.zombies,
    // Faster horde overall, and it ramps harder with depth — a deep floor is a
    // genuine sprint, not a shuffle. (Spiders multiply this again, see items.)
    zombieSpeed: Math.min(1.5 + 0.12 * l, 2.8),
    torches: budgets.torches,
    // Braiding grows with depth: shallow floors are corridor duels (few loops),
    // deep floors are open labyrinths full of flanking routes and dead-end
    // ambush pockets. Capped so it never dissolves into an open room.
    braid: Math.min(0.14 + 0.04 * l, 0.4),
    windiness,
    // Rooms + secrets ride depth too: deeper floors are busier theme parks.
    rooms: Math.min(ROOMS_BASE + Math.floor((l - 1) * ROOMS_PER_LEVEL), ROOMS_MAX),
    secrets: Math.min(SECRETS_BASE + Math.floor((l - 1) * SECRETS_PER_LEVEL), SECRETS_MAX),
    // A1 break-through budget: funds both the safety fixes (no boost into an
    // unbreakable wall) and the payoff cracks (a lane that punches through).
    // Grows with depth so deeper floors expand more as you smash outward.
    launchBreaks: Math.min(8 + Math.floor((l - 1) / 2), 16),
  };
}
