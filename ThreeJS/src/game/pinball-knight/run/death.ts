/**
 * DYING — the corpse you leave, the kit you drop, and the two ways back.
 *
 * Extracted verbatim from core.ts. Death and the tavern return are one
 * connected component: dying offers a retry, the retry goes through the tavern,
 * and the tavern descends again. Splitting them further would buy nothing but a
 * wider injected-dep surface.
 */
import { state } from "../state";
import { runDeps } from "./deps";
import { descendInto, adoptPoolSeedWhenItArrives } from "./descend";
import { addPile, canLoot, localKnightId, pilesOnFloor, type CorpseItem } from "../corpse-run";
import { sweepCoins } from "../economy/coins";
import { submitRunScore, beginRunLedger } from "./ledger";
import { showToast } from "../ui";
import { gameOverScreen } from "../gui/screens/game-over";
import { push as pushUiScreen } from "../gui/stack";
import { sfxGameOver } from "../sfx";
import { coopAnnounceDeath } from "../coop";
import { createStaticSprite } from "../engine/render/sprite";
import { ITEM_PAINTS } from "../render/cel-painter";
import { cardBase } from "../cards";
import { freshWeapon } from "../items";
import { nextItemNid } from "../economy/ground-items";
import { tileCenter, worldToTile, isWalkable } from "../maze/generator";
import { nearestOpenTile } from "../maze/nearest-open-tile";
import { enterTavern } from "../../../scenes/tavern";
import { getPlayerName } from "../../../services/player-name";
import type { Grid } from "../maze/generator";
import { myId } from "../../../net/presence";
import { saveResumeFloor } from "../corpse-run";
import { resetCombatJuice } from "../entities/combat";
import { playerMaxHp } from "../skill-runtime";
import { freshPlayerFields } from "../state";
import { exitRampage } from "../fps";


/**
 * Lay out every corpse pile stored for this floor as ground items.
 *
 * ⚠️ THE POSITION IS NOT TRUSTWORTHY. Floors are regenerated from the run seed
 * every time you enter them, so the tile you died on may now be solid wall (or
 * off-grid entirely, if the maze came out smaller). A pile inside a wall is gear
 * the player can see and never reach — the exact failure this feature exists to
 * prevent. So the saved spot is a HINT: `nearestOpenTile` walks out to the
 * closest standable tile, the same fix `tearGraveHole` uses for departed peers.
 *
 * Items fan out around that tile so a ten-item pile reads as a scatter of loot
 * rather than one sprite with nine hidden underneath it.
 */
export function spawnCorpsePiles(grid: Grid, level: number): void {
  if (!state.scene) return;
  const me = myId();
  for (const pile of pilesOnFloor(level)) {
    let t = worldToTile(grid, pile.x, pile.z);
    if (!isWalkable(grid, t.i, t.j)) {
      const open = nearestOpenTile(grid, t.i, t.j, 1);
      if (!open) continue; // this floor has nowhere to put it — try again next visit
      t = open;
    }
    const centre = tileCenter(grid, t.i, t.j);
    pile.items.forEach((item, n) => {
      // A CARD in a pile is an INSTANCE id ("spidersilk#4s") and ITEM_PAINTS is
      // keyed by card KIND, so the raw lookup misses and the `!paint` guard
      // below would drop the item silently — invisible on the floor AND
      // unrecoverable. cardBase is a no-op on every other kind's id.
      const paint = ITEM_PAINTS[item.id] ?? ITEM_PAINTS[cardBase(item.id)];
      if (!paint) return; // an id from an older build — skip the sprite, keep the save
      const sprite = createStaticSprite(paint);
      // Fan out on a small ring; index 0 sits dead centre on the death spot.
      const ang = (n / Math.max(1, pile.items.length)) * Math.PI * 2;
      const r = n === 0 ? 0 : 0.34;
      const x = centre.x + Math.cos(ang) * r;
      const z = centre.z + Math.sin(ang) * r;
      sprite.mesh.position.set(x, 0, z);
      state.scene!.add(sprite.mesh);
      state.groundItems.push({
        kind: item.kind,
        id: item.id,
        x,
        z,
        sprite,
        bobPhase: Math.random() * Math.PI * 2,
        durability: item.durability,
        rarity: item.rarity,
        cards: item.cards,
        upgrade: item.upgrade,
        // OWNER-ONLY. Monster loot stays shared with the pool; a corpse is not
        // loot, it's the player's own run sitting on the floor. Checked at the
        // pickup funnel so the pile still RENDERS for everyone.
        corpseOwner: pile.owner,
        corpseId: pile.id,
      });
    });
    if (canLoot(pile, me)) {
      showToast("⚰️ YOUR KIT IS HERE", `${pile.items.length} item${pile.items.length === 1 ? "" : "s"} from a previous death`);
    }
  }
}

/**
 * Serialize everything the knight is carrying into a corpse pile.
 *
 * Weapons and cards carry their full identity (durability, rarity, sockets,
 * upgrade level) because losing a +3 legendary and recovering a plain one would
 * be worse than losing it outright. Gear is a bare slot→durability map in this
 * codebase (see items.GearState), so that is all there is to carry.
 *
 * The starting sword is deliberately INCLUDED. It is worth little, but a pile
 * that silently omits part of what you were holding teaches players not to
 * trust the mechanic, and that distrust costs more than the sword.
 */
export function collectCorpseItems(): CorpseItem[] {
  const items: CorpseItem[] = [];
  for (const w of state.weaponSlots) {
    if (!w || w.id === "fists") continue;
    items.push({ kind: "weapon", id: w.id, durability: w.durability, rarity: w.rarity, cards: w.cards, upgrade: w.upgrade });
  }
  for (const [slot, dur] of Object.entries(state.gear)) {
    if (typeof dur !== "number" || dur <= 0) continue;
    items.push({ kind: "gear", id: slot, durability: dur });
  }
  for (const id of state.cardStash) items.push({ kind: "card", id });
  return items;
}

export function onPlayerDeath(): void {
  if (state.gameOver) return;
  if (state.fpsActive) exitRampage();
  state.gameOver = true;
  coopAnnounceDeath(); // final pose w/ mode:"death" — peers stop colliding with the body
  // Bank the loose change before the run is scored — the run tally on the death
  // screen should include coins that were still mid-flight when you died.
  sweepCoins();
  // Fire-and-forget at the call site is fine ONLY because submitRunScore itself
  // awaits and logs; the death screen must not wait on the network to appear.
  void submitRunScore();
  sfxGameOver();
  state.player?.sprite.setTint(0x6b7688); // drained

  // ── Drop the kit where you fell ──
  // Recorded BEFORE the inventory is cleared below, and persisted immediately:
  // a player who closes the tab on the death screen must still find their pile
  // when they come back, or the promise only holds for players who are polite
  // about how they quit.
  const dropped = collectCorpseItems();
  const p = state.player;
  // The STABLE knight id, not `myId()`. The pool socket id is minted per
  // connection, so a pile stamped with it became unlootable the moment you
  // reconnected — your own kit, refused as "another knight's".
  addPile(state.level, p?.x ?? 0, p?.z ?? 0, localKnightId(), dropped);
  // The floor you DIED on — not the deepest you reached. That difference is the
  // feature: the tavern sends you back to where your stuff is.
  saveResumeFloor(state.level);

  const deathFloor = state.level;
  // The screen pops itself; all that is left is clearing the run's own flag.
  const dismiss = (): void => {
    state.gameOver = false;
  };

  const gameOverOpts = {
    droppedCount: dropped.length,
    // Death returns you to the TAVERN with an empty pack, rather than
    // restarting at floor 1. The kit is not gone — it is on the floor above,
    // and the tavern's plunger offers the trip back.
    onTavern: () => {
      dismiss();
      returnToTavern();
    },
    // RETRY MAZE is the same reset, minus the hub: straight back down to the
    // floor you died on, which is also where your pile is. The floor is
    // regenerated from the run seed, so this is a fresh maze at the same depth
    // — a "retry", not a rewind.
    onRetry: (targetFloor?: number) => {
      dismiss();
      resetKnightAfterDeath();
      const floor = targetFloor ?? deathFloor;
      if (!state.container) {
        runDeps().startLevel(floor);
        return;
      }
      runDeps().armFloorLoading(floor, () => {
        adoptPoolSeedWhenItArrives(descendInto(floor));
      });
    },
    onExit: () => runDeps().exitDungeonGame(),
  };
  pushUiScreen(gameOverScreen(gameOverOpts));
}

/**
 * Strip the knight back to bare hands for the next attempt.
 *
 * Safe ONLY after `collectCorpseItems` has written the carried kit to a pile —
 * this is the step that makes death cost the gear rather than delete it. Wallet
 * gold and legacy perks survive, as they always have.
 *
 * Shared by both ways back in (tavern and retry) so the two paths cannot drift:
 * a retry that skipped, say, `beginRunLedger` would post its score against the
 * dead run's ledger.
 */
function resetKnightAfterDeath(): void {
  state.kills = 0;
  state.goldRun = 0;
  state.weaponSlots = [freshWeapon("sword"), null];
  state.activeSlot = 0;
  state.gear = {};
  state.cardStash = [];
  // The cards found on the floor you died on are lying on your corpse now, not
  // in your hand — there is no haul to reveal on the way out.
  state.floorHaul = [];
  resetCombatJuice();
  if (state.player) {
    Object.assign(state.player, freshPlayerFields());
    state.player.sprite.setTint(null);
    state.player.hp = playerMaxHp(); // after fresh fields
  }
  beginRunLedger(); // the next descent is a NEW run for the board
  state.hudDirty = true;
}

/**
 * Wake up in the tavern after a death: the run's carried kit is now lying on the
 * floor you died on, so the knight is reset to bare hands and sent to the hub.
 *
 * Wallet gold and legacy perks survive (they always have). What is new is that
 * losing the run no longer loses the gear — `state.cardStash` and the weapon and
 * gear slots are cleared here only because `collectCorpseItems` has already
 * written them to a pile.
 */
export function returnToTavern(): void {
  const deathFloor = state.level;
  resetKnightAfterDeath();
  if (!state.container) {
    runDeps().startLevel(1);
    return;
  }
  // A death drops you into the hub in LOBBY mode, exactly like first entry: it
  // is where the pool gathers, and someone who just died is precisely the player
  // who wants to see whether anyone is on a floor worth joining.
  enterTavern(state.container, {
    stats: { grade: "-", floor: deathFloor, kills: 0, bestCombo: 0 },
    // Same single entry as first boot: rally onto the pool's floor, catch the
    // knight up to that depth, then reconcile the seed. `descendInto` also
    // re-runs initCoop — the death teardown dropped the dungeon-scene presence
    // subscriptions, and without re-installing them you descend into a floor
    // where no pool-mate is ever drawn.
    onDescend: (floor?: number) => {
      adoptPoolSeedWhenItArrives(descendInto(floor));
    },
    onAbandon: () => runDeps().exitDungeonGame(),
    lobby: true,
  });
}
