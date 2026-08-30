/**
 * DESCENDING — the one way down, and everything that reconciles a descent with
 * the rest of the pool.
 *
 * Extracted verbatim from core.ts. The co-op timing constants live here because
 * this file holds their only readers, and both are MEASURED rather than guessed
 * (see their docblocks) — a fact that is easy to lose if they drift away from
 * the code that depends on them.
 *
 * ⚠️ One docblock was deleted on the way over, not moved: it described a
 * "resolve once the pool seed is known" function that no longer exists, and had
 * been sitting above `descendInto` documenting nothing. The block that DOES
 * document `adoptPoolSeedWhenItArrives` was also misfiled above `descendInto`;
 * it has been reunited with its function.
 */
import { state } from "../state";
import { runDeps } from "./deps";
import { peers, poolStatus } from "../../../net/presence";
import { resolveDescendFloor, regroupTarget } from "../../../net/rally";
import { loadResumeFloor } from "../corpse-run";
import { initCoop, isCoop, coopSeed } from "../coop";
import { applyDelveCatchUp } from "../delve";
import { sweepCoins } from "../economy/coins";
import { addGold } from "../../../utils/gold-wallet";
import { showToast, showPickupNote } from "../ui";
import { openVaultOnBossDefeat } from "../lamp-puzzle";
import { sfxStairs } from "../sfx";
import { enterTavern } from "../../../scenes/tavern";
import { haulScreen } from "../gui/screens/haul";
import { push as pushUiScreen } from "../gui/stack";
import { gradeFloor } from "./grade";
import { submitRunScore, beginRunLedger } from "./ledger";
import { exploredFraction } from "../fog";
import { tileCenter } from "../maze/generator";
import { spawnCoin } from "../economy/coins";
import { dropWeapon } from "../economy/loot";
import { GOLD_PER_DESCENT } from "../constants";
import { BONUS_ROOM_GRADES, BOSS_GOLD } from "../constants";
import { nextItemNid } from "../economy/ground-items";
import { createStaticSprite } from "../engine/render/sprite";
import { ITEM_PAINTS } from "../render/cel-painter";
import { floorFlow } from "../run/grade";
import { getSettings } from "../settings-save";
import { awardFloorXp, playerMaxHp } from "../skill-runtime";

/**
 * How long we keep WATCHING for the shared seed after a floor has been built.
 *
 * MEASURED, not guessed: with two clients connecting at once under software
 * rendering, the second one's handshake completed at ~2.0s (the first's at
 * ~1.6s). A 1.2s budget expired while that client was still `connecting`, so it
 * kept a private floor — the bug this reconciliation exists to fix. 5s leaves
 * real headroom on a slow link.
 *
 * Nothing is blocked while this runs (see adoptPoolSeedWhenItArrives), so a
 * generous window costs an offline player only a handful of cheap frame checks.
 */
const POOL_SEED_WAIT_MS = 5000;

/**
 * How long after landing we keep watching for a pool-mate who descended in the
 * same breath (see regroupWithPoolWhenTheyLand).
 *
 * Sized off the SAME measurement as POOL_SEED_WAIT_MS — a second client's
 * handshake can take ~2s, and until it lands neither knight is in the other's
 * roster. Past this window a player is playing the floor, and moving them is
 * worse than letting them regroup through the join board.
 */
const REGROUP_WINDOW_MS = 6000;

export function dropBossReward(x: number, z: number): void {
  // The windfall drops as a FISTFUL of coins (spawnCoin caps the count and
  // self-credits when headless) — the milestone should be something you watch
  // fly into you, not a number that appears. Deliberately ahead of the scene
  // guard: the gold must land even in a headless harness.
  spawnCoin(x, z, BOSS_GOLD);
  if (!state.scene) return;
  showToast("OVERLORD SLAIN", `+${BOSS_GOLD} gold · the way down is clear`);
  // He was standing over the floor's sealed vault — the kill is its key. No-op
  // on a floor that rolled no puzzle, or one already opened by the braziers.
  openVaultOnBossDefeat();
  const drops: Array<{ id: string; dx: number; dz: number }> = [
    { id: "health", dx: -0.5, dz: 0 },
    { id: "gold", dx: 0.5, dz: 0 },
  ];
  for (const d of drops) {
    const sprite = createStaticSprite(ITEM_PAINTS[d.id]);
    const px = x + d.dx;
    const pz = z + d.dz;
    sprite.mesh.position.set(px, 0, pz);
    state.scene.add(sprite.mesh);
    state.groundItems.push({ nid: nextItemNid(), kind: "potion", id: d.id, x: px, z: pz, sprite, bobPhase: Math.random() * 6 });
  }
  state.hudDirty = true;
}

/**
 * 🪜 THE ONE WAY DOWN from the tavern — used by the plunger, the join board and
 * the retry-after-death path alike.
 *
 * Descending is no longer personal. `resolveDescendFloor` sends you to the floor
 * the POOL is on, because the alternative (everyone to their own resume depth)
 * is what made two players who entered one after the other play two separate
 * games: the server relays world/act to same-scene peers only, so two floors are
 * two worlds and every co-op feature — shared enemies, shared loot, scaled boss
 * — silently never fired. An explicit join-board pick still wins; your own
 * resume floor is the fallback when the pool is all still in the tavern.
 *
 * Arriving deep with a level-1 knight is made survivable by `applyDelveCatchUp`,
 * not by keeping the pool apart.
 *
 * Returns the floor actually entered.
 */
export function descendInto(explicit?: number): number {
  const target = resolveDescendFloor(peers(), loadResumeFloor(), explicit);
  runDeps().startLevel(target); // startLevel adopts the shared pool seed (coopSeed) if connected
  initCoop(); // spin up dungeon-scene pool presence (no-op offline)
  grantDelveBoon(target);
  regroupWithPoolWhenTheyLand(target);
  return target;
}

/** Scale a knight who DROPPED to this depth up to what the depth expects, and
 *  say so. No-op on floor 1 and for anyone who walked down honestly. */
export function grantDelveBoon(target: number): void {
  const boon = applyDelveCatchUp(target);
  if (!boon) return;
  const p = state.player;
  if (p && boon.hearts > 0) p.hp = Math.min(playerMaxHp(), p.hp + boon.hearts);
  const bits = [
    boon.levels > 0 ? `+${boon.levels} LVL` : "",
    boon.hearts > 0 ? `+${boon.hearts} ❤` : "",
    boon.upgrade > 0 ? `+${boon.upgrade} BLADE` : "",
  ].filter(Boolean);
  showToast(`⚗️ DELVER'S BOON · FLOOR ${target}`, bits.join("  ·  ") || "kitted for the depth");
}

/**
 * Converge with the pool when two knights descended in the same breath.
 *
 * Both resolved their target against a roster that did not know about the other
 * yet, so they can land on different floors — the exact "we entered one after
 * the other and got separate games" failure, just compressed into one second.
 * A moment later both rosters agree and `regroupTarget` (which counts the
 * caller's OWN floor) returns the same answer on both machines, so exactly one
 * of them moves.
 *
 * Same shape and the same reasoning as `adoptPoolSeedWhenItArrives`: never block
 * the descent on the network, generate at once, reconcile if the pool disagrees,
 * and only ever while the player is still standing on the floor they arrived on
 * — regrouping someone mid-fight would be worse than being apart.
 */
export function regroupWithPoolWhenTheyLand(startedOnLevel: number): void {
  const started = performance.now();
  const tick = (): void => {
    if (!state.active || !isCoop()) return;
    if (state.level !== startedOnLevel) return; // they moved on — leave them alone
    const target = regroupTarget(peers(), state.level);
    if (target !== null) {
      showToast("🧲 REGROUPING", `the pool is on floor ${target}`);
      runDeps().startLevel(target);
      grantDelveBoon(target);
      // Re-arm the seed watcher: the one the descent started gives up the
      // moment `state.level` changes, and a floor rebuilt while `welcome` is
      // still in flight would keep a private maze on the floor we just moved to.
      adoptPoolSeedWhenItArrives(target);
      return;
    }
    if (performance.now() - started > REGROUP_WINDOW_MS) return;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/**
 * Adopt the shared seed if it shows up AFTER the floor was already built, and
 * rebuild that floor so it matches everyone else's.
 *
 * ⚠️ WHY NOT BLOCK THE DESCENT INSTEAD. The obvious version — await the seed,
 * then generate — was built first and was WRONG: it holds the whole game behind
 * a network round-trip, and under software rendering the polling chain that
 * implemented it got starved and never resolved at all, so the run simply never
 * started (the harness saw hooks present but `active` forever undefined).
 * Blocking a boot on a backend that may not answer is a bad trade regardless of
 * how the wait is written.
 *
 * So the descent is never delayed. The floor is generated at once from a local
 * seed; if `welcome` lands later and disagrees, we rebuild the CURRENT floor
 * against the shared seed. A solo player never pays anything, and a pool player
 * gets a one-off regeneration in the first moments instead of a hang.
 *
 * Only ever fires while still on the floor the run started on: rebuilding under
 * someone who has already descended would teleport them into a fresh maze.
 */

export function adoptPoolSeedWhenItArrives(startedOnLevel: number): void {
  if (coopSeed() !== null) return; // already shared — nothing to reconcile
  const started = performance.now();
  const tick = (): void => {
    if (!state.active) return;
    const seed = coopSeed();
    if (seed !== null) {
      // Someone else's world is authoritative. Rebuild only if we actually
      // disagree, and only if the player hasn't moved on to another floor.
      if ((seed >>> 0) !== state.runSeed && state.level === startedOnLevel) {
        runDeps().startLevel(startedOnLevel);
      }
      return;
    }
    if (poolStatus() === "closed" || performance.now() - started > POOL_SEED_WAIT_MS) return;
    // requestAnimationFrame, NOT setTimeout: under software rendering the timer
    // queue is starved hard enough that a 30ms chain stalls outright, while RAF
    // is tied to the frames the game is already producing.
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function descend(): void {
  // BANK ANY COINS STILL ON THE FLOOR before the tavern opens.
  //
  // Every other sweep site is a teardown (startLevel, death, exit), and the
  // tavern is not one — `startLevel` only runs when you LEAVE it, via
  // `onDescend` below. So without this, gold you killed for but never walked
  // over is missing from the purse in the one place gold is spendable: you
  // clear a floor, leave ~30g of coins lying in the maze, and the shop and the
  // gambler both read a balance that doesn't include it. `maxStake()` shrinks
  // too, so you can't even bet what you should be able to. It lands one floor
  // late, after you've already spent.
  //
  // A straight regression from making coins physical — before that, a kill was
  // banked the instant it happened.
  sweepCoins();

  // Grade the floor being left BEFORE startLevel resets the ledger.
  const { grade, gold } = gradeFloor();
  awardFloorXp(state.level, grade); // character XP, scaled by the grade
  state.goldRun += GOLD_PER_DESCENT + gold;
  addGold(GOLD_PER_DESCENT + gold, "dungeon-game");
  // Run-scoped shot ledger for the leaderboard (see run-score.ts) — banked on
  // the way out, because startLevel is about to wipe the per-floor half.
  state.runJackpots += state.jackpots;
  state.runOrbitLaps += state.orbitLaps;
  state.runNamedShots += Object.keys(state.namedPaid).length;
  state.runBestFlow = Math.max(state.runBestFlow, floorFlow());
  // ── THE FLAWLESS FLOOR ──
  // Clear a floor without being hit once and keep a heart, permanently, for
  // the rest of the run. The game teaches one skill above all others — read
  // the table, carry your line, don't get touched — and until now it paid
  // nothing for the perfect execution of it. Deliberately a MAX-hp gain
  // rather than a heal, so it compounds into the runs that go deep.
  if (state.levelHitsTaken === 0) {
    state.runFlawlessFloors += 1;
    state.bonusMaxHp += 1; // the same run-scoped seam playerMaxHp() already reads
    if (state.player) state.player.hp = Math.min(playerMaxHp(), state.player.hp + 1);
    showToast("🛡 FLAWLESS FLOOR", "untouched — the vessel holds one more heart");
    state.hudDirty = true;
  }
  // A great floor unlocks a BONUS vault room on the next one (Wave F glue).
  state.bonusRoomNext = BONUS_ROOM_GRADES.includes(grade);
  // …and SAYS so. This reward has existed silently since Wave F: the next
  // floor quietly carved an extra room and the player was never told, so the
  // single strongest reason to chase an S was invisible.
  if (state.bonusRoomNext) showToast(`✦ GRADE ${grade}`, "the deep floor opens a VAULT for you");
  sfxStairs();
  const nextLevel = state.level + 1;
  const kills = state.kills;
  const bestCombo = state.levelBestCombo;
  const floorCleared = state.level;
  // Captured HERE, because startLevel wipes the ledger before the note shows.
  // Flow is a grade axis now, so it has to be legible — an invisible axis is
  // the same bug as the silent bonus room above, and players cannot learn to
  // chase a number the game never prints.
  const flowPct = Math.round(floorFlow() * 100);
  const gradeLine = `FLOOR GRADE ${grade} · flow ${flowPct}% · combo ×${bestCombo}${gold > 0 ? ` · +${gold}g` : ""}`;

  // ── Between-floor TAVERN hub ── spend the run's gold + cards, then descend.
  const toTavern = (): void => {
    if (!state.container) {
      runDeps().startLevel(nextLevel);
      showPickupNote(gradeLine);
      return;
    }
    enterTavern(state.container, {
      stats: { grade, floor: floorCleared, kills, bestCombo },
      onDescend: () => {
        runDeps().armFloorLoading(nextLevel, () => {
          runDeps().startLevel(nextLevel);
          showPickupNote(gradeLine);
        });
      },
      // The tavern's game menu (Esc/I) carries the same confirmed ABANDON as
      // the dungeon's; the tavern closes itself first, then this ends the run.
      onAbandon: () => runDeps().exitDungeonGame(),
    });
  };

  // ── THE FLOOR HAUL ──
  // Every card found on this floor, read as one screen on the way out. This is
  // the ONLY place card faces are shown at size: mid-fight they are a corner
  // toast, because a modal in the middle of a bounce chain is an interruption
  // the player never asked for.
  //
  // The haul takes the same `cardReaderEl` pause the tavern takes, so `descend`
  // cannot re-fire from the stairs underneath it, and `toTavern` runs on its
  // dismissal. Emptied here whether or not it is shown — a haul carried into
  // the next floor would be revealed twice.
  const haul = state.floorHaul;
  state.floorHaul = [];
  if (getSettings().haulReveal) pushUiScreen(haulScreen(haul, floorCleared, toTavern));
  else toTavern();
}
