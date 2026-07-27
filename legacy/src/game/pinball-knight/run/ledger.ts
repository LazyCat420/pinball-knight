/**
 * The run ledger — what a leaderboard row is made of.
 *
 * Extracted verbatim from core.ts. These fields describe the WHOLE run, so they
 * are deliberately separate from the per-floor state `startLevel` wipes on every
 * descent; keeping them in one module is what makes that distinction visible
 * rather than a comment you have to trust.
 */
import { getPlayerName } from "../../../services/player-name";
import { saveLeaderboardScore } from "../../../services/score-service";
import { cardKey, cardsOfRarity, rollCardLevel, rollShiny } from "../cards";
import { hasStartCardPerk } from "../legacy";
import { runDetail, scoreRun, type RunStats } from "../run-score";
import { invalidateSkillAgg, playerMaxHp } from "../skill-runtime";
import { state } from "../state";

/**
 * Begin a NEW run's leaderboard ledger.
 *
 * Separate from `startLevel`, which runs on every descent and wipes the
 * per-floor ledger. These fields must survive a descent — they describe the
 * whole run, which is what a leaderboard row is.
 */
export function beginRunLedger(): void {
  state.runDeepestFloor = 1;
  state.runBestCombo = 0;
  state.runStartMs = performance.now();
  state.pausedRunS = 0;
  state.runScoreSubmitted = false;
  beginRunProgression();
}

/**
 * A NEW RUN's character progression: the tree resets with the run (roguelite),
 * the memoized aggregate re-reads any legacy perks bought since, and the Pack
 * Rat perk seeds the stash. Piggybacks on beginRunLedger because "what counts
 * as a new run" must have exactly one definition (launch AND retry hit it).
 */
function beginRunProgression(): void {
  state.charXp = 0;
  state.charLevel = 1;
  state.skillPoints = 0;
  state.skillRanks = {};
  state.unlockedAbilities = ["flippercharge", "arcanepulse"];
  state.seenCards = new Set();
  // The alchemy pouch is run-scoped — a new run starts you empty-handed (only
  // wallet gold + legacy perks carry over). See reagents.ts / recipes.ts.
  state.reagents = {};
  state.flasks = 0;
  state.bonusMaxHp = 0;
  invalidateSkillAgg();
  if (hasStartCardPerk()) {
    const bag = cardsOfRarity("common");
    // Floor 1 levels — this is a RUN-START seed, so it rolls off where the run
    // begins rather than where the last one ended.
    state.cardStash.push(cardKey(bag[Math.floor(Math.random() * bag.length)], rollCardLevel(1), rollShiny()));
  }
  if (state.player) state.player.hp = playerMaxHp();
}

/** Gather the run-scoped ledger into the shape `run-score.ts` grades. */
function currentRunStats(): RunStats {
  return {
    deepestFloor: state.runDeepestFloor,
    bestCombo: state.runBestCombo,
    kills: state.kills,
    gold: state.goldRun,
    durationS: state.runStartMs > 0 ? Math.max(0, (performance.now() - state.runStartMs) / 1000 - state.pausedRunS) : 0,
  };
}

/**
 * Post the finished run to the leaderboard.
 *
 * Guarded by `runScoreSubmitted` because death and the "leave" path can both
 * reach here for the same run, and a duplicated row is worse than a missing one.
 *
 * Deliberately awaited and its result inspected: `saveLeaderboardScore` returns
 * `Promise<boolean>` and a 4xx does NOT reject the underlying fetch, so a
 * fire-and-forget call reports a rejected score as a save. That exact bug hid
 * raccoon-tornado's failures for months — do not "simplify" this back.
 */
export async function submitRunScore(): Promise<void> {
  if (state.runScoreSubmitted) return;
  state.runScoreSubmitted = true;

  const stats = currentRunStats();
  const score = scoreRun(stats);
  const name = getPlayerName();

  const ok = await saveLeaderboardScore(
    score,
    name,
    0, // maxAltitude — not meaningful here; the schema is shared across games
    0, // distance — ditto
    stats.deepestFloor, // tunnelDepth is the closest existing column to "how deep"
    "pinball-knight",
    runDetail(stats),
  );
  if (!ok) console.warn("[dungeon] leaderboard rejected the run score");
}
