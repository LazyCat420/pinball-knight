/**
 * Wiring — where the game's callback bus is plugged in.
 *
 * The dependency graph here is kept acyclic by INJECTION: modules that need a
 * core-owned action take it through a setter instead of importing back up. All
 * of those `set*Handler` / `set*Deps` / `set*Hooks` calls used to sit inline in
 * `launchDungeonGame`; they are the same calls in the same order, now in the
 * one file whose job is "connect the parts".
 *
 * ⚠️ TWO FUNCTIONS, NOT ONE, AND THAT IS DELIBERATE. The wiring was never one
 * contiguous block: the dev/QA half runs BEFORE the HUD and input are built and
 * the gameplay half runs after. Collapsing them into a single call would move
 * roughly eighty lines of setup across the HUD boundary — the kind of reorder
 * that changes nothing you can see and everything you cannot. Core calls these
 * at exactly the two points the inline code occupied.
 *
 * `WiringDeps` is small on purpose: six functions. Everything else this file
 * needs it imports directly, which is what keeps it on the right side of
 * `core-boundary.test.ts` — nothing under boot/ may import core.ts.
 */
import * as THREE from "three";
import { state, type GroundItem, type MarbleMaterial } from "../state";
import { setDebugActionDeps, debugSpawn, debugClearEnemies } from "../dev/debug-actions";
import { installDevHooks } from "../dev/window-hooks";
import { setLevelUpHandler } from "../skill-runtime";
import { showToast } from "../ui";
import { sfxModifier } from "../sfx";
import { openShop, applyPotion } from "../economy/shop";
import { tearGraveHole } from "../run/grave-hole";
import {
  setCoopHooks,
  isReplica,
  coopForwardDamage,
  coopBroadcastKill,
} from "../coop";
import { onPeerArrive } from "../../../net/presence";
import {
  setBossDefeatedHandler,
  setSlimeSplitHandler,
  setCardRollHandler,
  setCoinDropHandler,
  setReagentDropHandler,
  setGolemShatterHandler,
  setBloaterBurstHandler,
  setCoopCombatBridge,
  damageZombie,
  hitPlayerRanged,
  resetCombatJuice,
} from "../entities/combat";
import { setSummonHandler } from "../entities/zombie";
import { setMerchantCaughtHandler } from "../entities/npc";
import { queueMini, queueSummon, makeZombie, bumpZombieNid } from "../spawn/factory";
import { dropCardMaybe, dropReagentsMaybe, spawnMaterialDrop } from "../economy/loot";
import { spawnCoin } from "../economy/coins";
import { golemShards } from "../entities/projectiles";
import { spawnFloorFx } from "../entities/floor-fx";
import { MATERIAL_LIST } from "../entities/marble";
import { createStaticSprite } from "../engine/render/sprite";
import { reaperSheet } from "../render/reaper-sheet";
import { sheetFor, SHEET_KEY_BY_KIND } from "./sheets";
import { ITEM_PAINTS } from "../render/cel-painter";
import { cardBase } from "../cards";
import {
  BLOATER_BURST_RADIUS,
  FIRE_PUDDLE_LIFE,
  BOSS_GOLD,
  GOLD_PER_KILL,
  REAPER_TINT,
} from "../constants";

/**
 * The core-owned actions the wiring hands out. Injected rather than imported so
 * the arrow keeps pointing one way: core → boot, never boot → core.
 */
export interface WiringDeps {
  spawnReaper: () => void;
  dropBossReward: (x: number, z: number) => void;
  startLevel: (level: number) => void;
  descend: () => void;
  onPlayerDeath: () => void;
  exitDungeonGame: () => void;
}

/**
 * The dev/QA surface and the level-up fanfare.
 *
 * Runs BEFORE the HUD exists — `installDevHooks` only stores callbacks, and the
 * debug VERBS need their deps wired before the hooks expose them.
 */
export function installDevWiring(deps: WiringDeps): void {
  const { spawnReaper, startLevel, descend, onPlayerDeath, exitDungeonGame } = deps;
  // Dev / QA `window.__dungeon*` hooks — see dev/window-hooks.ts. Everything a
  // headless harness drives (spawning, god-mode, pad injection, art QA) lives
  // there; the core-owned actions it needs are passed in, so the dependency
  // only ever points core → dev.
  // The debug VERBS (dev/debug-actions.ts) need one core-owned action; wire it
  // before installDevHooks, which exposes those verbs to the harness.
  setDebugActionDeps({ spawnReaper });
  installDevHooks({
    startLevel, descend, onPlayerDeath, openShop, applyPotion,
    debugSpawn, debugClearEnemies, exitDungeonGame, tearGraveHole,
  });

  // Level-up fanfare: toast + modifier sting; the tree lives in the menu (I).
  setLevelUpHandler((level, points) => {
    showToast(`LEVEL ${level}`, `+1 skill point · ${points} unspent — press I`);
    sfxModifier();
  });
}

/**
 * The gameplay callback bus: co-op hooks, the combat bridge, and every drop /
 * split / summon handler.
 *
 * Runs AFTER the HUD and input are built, exactly where it always did.
 */
export function installGameplayWiring(deps: WiringDeps): void {
  const { dropBossReward } = deps;
  // A slain overlord drops its reward here (kept out of combat.ts to avoid a
  // circular import).
  setBossDefeatedHandler(dropBossReward);

  // ── Co-op wiring ── the hooks coop.ts drives the shared world through, and
  // the bridge combat.ts forwards replica damage over. All injected here so
  // neither module imports core (no cycles).
  setCoopHooks({
    spawnGhost: (nid, kind, x, z, boss) => {
      // Snapshot said an enemy exists that we don't have — build a rendering
      // body for it. Sheet by kind, zombie-sheet fallback for exotic kinds.
      // Through sheetFor, not the raw state fields: atlases are built lazily
      // (boot/sheets.ts), and a PEER can be a floor deeper than us — so the one
      // monster we have never met is exactly the one whose sheet the backfill
      // may not have reached. Reading the field would draw it as a zombie.
      const sheet =
        kind === "reaper" || boss
          ? reaperSheet()
          : SHEET_KEY_BY_KIND[kind as string]
            ? sheetFor(SHEET_KEY_BY_KIND[kind as string])
            : state.zombieSheet;
      if (!sheet) return null;
      const z2 = makeZombie(sheet, x, z, 0, { kind, boss });
      z2.nid = nid; // adopt the authority's id (makeZombie minted a local one)
      bumpZombieNid(nid);
      // The Death Dealer's warning toast fires in spawnReaper — authority-only.
      // Without this, the replica player meets an immune scythe ghost with NO
      // explanation and reads it as a broken boss (exactly what live QA did).
      if (kind === "reaper") {
        showToast("☠ THE DEATH DEALER ☠", "it cannot be slain — take the stairs");
        state.shakeT = Math.max(state.shakeT, 0.3);
      }
      if (boss) {
        // The Reaper King's ghost looms like the real thing.
        z2.baseTint = REAPER_TINT;
        z2.sprite.setTint(REAPER_TINT);
        z2.sprite.mesh.scale.multiplyScalar(1.55);
      }
      state.zombies.push(z2);
      return z2;
    },
    spawnGhostItem: (nid, kind, id, x, z) => {
      // A CARD arrives over the wire as an instance id ("spidersilk#4s") and
      // ITEM_PAINTS is keyed by card KIND, so the raw id misses. cardBase is a
      // no-op on every other kind's id.
      const paint = ITEM_PAINTS[id] ?? ITEM_PAINTS[cardBase(id)];
      if (!paint || !state.scene) return null;
      const sprite = createStaticSprite(paint);
      sprite.mesh.position.set(x, 0, z);
      state.scene.add(sprite.mesh);
      const it: GroundItem = { nid, kind, id, x, z, sprite, bobPhase: Math.random() * 6 };
      state.groundItems.push(it);
      return it;
    },
    removeZombie: (z) => {
      state.scene?.remove(z.sprite.mesh);
      z.sprite.dispose();
    },
    removeItem: (it) => {
      state.scene?.remove(it.sprite.mesh);
      it.sprite.dispose();
    },
    onRemoteKill: (x, z, kind, boss) => {
      // The authority killed something on our floor: gibs + SHARED kill gold
      // (co-op pays every knight — gold is per-client, not split).
      if (kind === "ghost") state.vfx?.sparks(x, 0.6, z, 0, 0, 22);
      else state.vfx?.blood(x, 0.6, z, "green", 20);
      spawnCoin(x, z, boss ? BOSS_GOLD : GOLD_PER_KILL);
      if (boss) state.shakeT = Math.max(state.shakeT, 0.4);
    },
    applyDamage: (z, dmg, dx, dz, push) => {
      // A replica's hit, already gated by THEIR momentum — apply it raw
      // (force), except the untouchable Death Dealer.
      if (z.kind === "reaper") return;
      damageZombie(z, dmg, dx, dz, push, true);
    },
    hurtPlayer: (dmg, srcX, srcZ) => hitPlayerRanged(dmg, srcX, srcZ),
    tearHole: (x, z, name) => tearGraveHole(x, z, name),
  });
  setCoopCombatBridge({ isReplica, forward: coopForwardDamage, onKill: coopBroadcastKill });
  // A new knight joining the pool is announced wherever you are standing. Keyed
  // "dungeon" so re-entering replaces the hook rather than stacking one per
  // descend; presence drops it on stopPresence.
  onPeerArrive("dungeon", (p) => {
    showToast("🛡️ A KNIGHT HAS ARRIVED", `${p.name} joined the pool`);
  });
  // A slain big slime queues two minis, spawned after combat resolution.
  setSlimeSplitHandler(queueMini);
  setCardRollHandler(dropCardMaybe);
  // Every kill drops magnet-collected coins on the floor.
  setCoinDropHandler(spawnCoin);
  // …and a chance at themed alchemy reagents (RO-style loot).
  setReagentDropHandler(dropReagentsMaybe);
  // A shattered brick golem sprays ricochet shards.
  setGolemShatterHandler((x, z) => {
    golemShards(x, z);
    // Elite reward: a shattered brick golem sometimes yields a marble — biased
    // toward STONE (beat stone with stone), else a random material.
    if (Math.random() < 0.5) {
      const m: MarbleMaterial = Math.random() < 0.6 ? "stone" : MATERIAL_LIST[Math.floor(Math.random() * MATERIAL_LIST.length)];
      spawnMaterialDrop(x, z, m);
    }
  });
  // A BLOATER bursts into a burning puddle on death.
  setBloaterBurstHandler((x, z) => spawnFloorFx("fire", x, z, BLOATER_BURST_RADIUS, FIRE_PUDDLE_LIFE, true));
  // A NECROMANCER raises an add — deferred past the horde loop (like slime split).
  setSummonHandler(queueSummon);
  // Catching the rolling merchant opens its shop.
  setMerchantCaughtHandler(openShop);
  resetCombatJuice();
}
