/**
 * Debug ACTIONS — the shared implementations behind both the ` god-mode panel
 * and the `window.__dungeon*` harness hooks.
 *
 * Extracted from core.ts. These are the verbs (teleport, spawn a ring, kill
 * all, clear the floor); dev/window-hooks.ts is only the surface that exposes
 * them to a script, and debug-panel.ts the surface that exposes them to a
 * keypress. Keeping the verbs here stops those two from drifting apart.
 *
 * `spawnReaper` is injected rather than imported: it belongs to core's floor
 * lifecycle, and importing it would point this module back at core.
 */
import { snapCameraTo } from "../engine/camera";
import { ABILITY_RANK_MAX, levelConfig } from "../constants";
import { ABILITY_IDS, type AbilityId } from "../abilities";
import { SKILLS, SKILL_IDS, isKeystone, type SkillId } from "../skills";
import { invalidateSkillAgg, playerManaMax, syncAbilitySlots } from "../skill-runtime";
import { resolveSpawnPoints, type DebugSpawnResult, type DebugSpawnSpec } from "../debug-spawn";
import { damageZombie, setBossDefeatedHandler, syncActorMesh } from "../entities/combat";
import { at, tileCenter, worldToTile } from "../maze/generator";
import { nearestOpenTile } from "../maze/nearest-open-tile";
import { ITEM_PAINTS, ZOMBIE_VARIANTS } from "../render/cel-painter";
import { createStaticSprite, type SpriteSheet } from "../engine/render/sprite";
import { makeSkinned, makeZombie, skinSheet, spawnKind } from "../spawn/factory";
import { KIND_SKIN } from "../spawn/kind-skin";
import { state, type EnemyKind, type Zombie } from "../state";
import { variantIndicesFor, type ZombieType } from "../zombie-types";

/** Core-owned actions these helpers drive. Set once by launchDungeonGame. */
interface DebugActionDeps {
  spawnReaper: () => void;
}
let deps: DebugActionDeps = { spawnReaper: () => {} };

/** Wire the core-owned actions. Called once from launchDungeonGame. */
export function setDebugActionDeps(d: DebugActionDeps): void {
  deps = d;
}

/** Dev-only: warp the player a couple of tiles from the level exit. */
export function debugTeleportToStairs(): void {
  const g = state.grid;
  const p = state.player;
  if (!g || !p || !state.stairs) return;
  const c = tileCenter(g, state.stairs.i, state.stairs.j);
  p.x = c.x;
  p.z = c.z - 2; // stand a bit short of it so the beacon is in view
  syncActorMesh(p);
  snapCameraTo(p.x, p.z);
}

/**
 * The n-th nearest walkable tile to (ci,cj) by a small BFS ring scan — used by
 * the debug spawner so test enemies always land on real floor, never inside a
 * wall band. Returns null if nothing walkable is close.
 */

/**
 * Dev-only: drop one zombie of each cosmetic variant plus a giant spider in a
 * ring around the player, so the horde's variety and the spider read at a
 * glance without hunting the maze. Bound to the hidden `p` key.
 */
export function debugSpawnRing(): void {
  const p = state.player;
  const g = state.grid;
  if (!p || !g || !state.scene) return;
  const sheets = [...state.zombieVariantSheets];
  const specs: Array<{ sheet: SpriteSheet; kind: EnemyKind }> = sheets.map((sheet) => ({ sheet, kind: "zombie" as EnemyKind }));
  if (state.sheets.spider) specs.push({ sheet: state.sheets.spider, kind: "spider" });
  if (state.sheets.brute) specs.push({ sheet: state.sheets.brute, kind: "brute" });
  if (state.sheets.spitter) specs.push({ sheet: state.sheets.spitter, kind: "spitter" });
  if (state.sheets.ghost) specs.push({ sheet: state.sheets.ghost, kind: "ghost" });
  if (state.sheets.bat) specs.push({ sheet: state.sheets.bat, kind: "bat" });
  if (state.sheets.slime) specs.push({ sheet: state.sheets.slime, kind: "slime" });
  // The Wave-B reskins, so the whole roster is inspectable in one ring.
  for (const kind of ["goblin", "pin", "golem", "chomper", "magnet", "webspinner"] as EnemyKind[]) {
    const sheet = skinSheet(kind);
    if (sheet) specs.push({ sheet, kind });
  }
  // Place each enemy on the nearest WALKABLE tile stepping outward from the
  // player (blind fixed offsets would bury them in a wall, and a spitter's glob
  // would then die on that wall before reaching you). Speed 0 poses them for
  // art QA; aggro=true so a spitter actually spits + a brute winds up.
  const pt = worldToTile(g, p.x, p.z);
  specs.forEach((spec, i) => {
    const spot = nearestOpenTile(g, pt.i, pt.j, i + 1) ?? pt;
    const c = tileCenter(g, spot.i, spot.j);
    const zz = makeZombie(spec.sheet, c.x, c.z, 0, { kind: spec.kind });
    const skin = KIND_SKIN[spec.kind];
    if (skin) zz.sprite.mesh.scale.multiplyScalar(skin.scale);
    zz.aggro = true;
    zz.anim.setFacing("S");
    zz.anim.play("walk", { force: true });
    state.zombies.push(zz);
  });
  // Also scatter every potion in a tight ring right around the player, so a
  // small wiggle picks them all up (pickup + effect QA) and the art is visible.
  ["health", "rage", "haste", "shield", "gold", "ballform", "freeze", "multiball", "curveshot", "magnetcore", "magnetboots"].forEach((id, i, arr) => {
    if (!state.scene) return;
    const sprite = createStaticSprite(ITEM_PAINTS[id]);
    const a = (i / arr.length) * Math.PI * 2;
    const px = p.x + Math.cos(a) * 0.6;
    const pz = p.z + Math.sin(a) * 0.6;
    sprite.mesh.position.set(px, 0, pz);
    state.scene.add(sprite.mesh);
    state.groundItems.push({ kind: "potion", id, x: px, z: pz, sprite, bobPhase: i * 1.3 });
  });
}

// ── Debug-panel action helpers (used by the ` god-mode console) ──

/**
 * Build ONE enemy of any kind at a world position, bypassing the level gates.
 * The single place that knows which construction path a kind takes (plain
 * zombie sheet / reskin / spawnKind), so every debug spawn route shares it.
 */
export function makeDebugEnemy(kind: EnemyKind, x: number, z: number, ztype?: ZombieType): Zombie | null {
  const speed = levelConfig(state.level).zombieSpeed;
  if (kind === "zombie") {
    // A sub-typed debug spawn must wear the matching SILHOUETTE, or the headless
    // art check is looking at a shambler with a hulk's stats and passes for the
    // wrong reason.
    const allowed = ztype ? variantIndicesFor(ztype, ZOMBIE_VARIANTS) : [0];
    const sheet = state.zombieVariantSheets[allowed[0]] ?? state.zombieVariantSheets[0] ?? state.sheets.zombie;
    return sheet ? makeZombie(sheet, x, z, speed, { kind: "zombie", ztype }) : null;
  }
  if (KIND_SKIN[kind]) return makeSkinned(kind, x, z, speed);
  return spawnKind(kind, x, z, speed, 99); // level 99 clears every FROM_LEVEL gate
}

/** What a scripted spawn can ask for beyond "one of these, next to me". */
// DebugSpawnSpec / DebugSpawnResult now live in debug-spawn.ts, next to the
// SpawnLayout they extend, so dev/window-hooks.ts can type itself without
// importing back up into core.

/**
 * Spawn a GROUP of enemies in a known shape (see debug-spawn.ts) — the scripted
 * counterpart to the panel's one-click chips.
 *
 * Returns what was actually placed, including a `spawned < requested` when the
 * room was too tight, so a headless test never asserts against a horde it did
 * not get.
 */
export function debugSpawn(spec: DebugSpawnSpec): DebugSpawnResult {
  const p = state.player;
  const g = state.grid;
  const requested = Math.max(0, Math.floor(spec.count));
  const empty: DebugSpawnResult = { spawned: 0, requested, kind: spec.kind, points: [] };
  if (!p || !g) return empty;
  // The Reaper is a floor-wide singleton with its own summon ritual, not a
  // thing you can place N of.
  if (spec.kind === "reaper") {
    if (!state.reaperOut) deps.spawnReaper();
    return { ...empty, spawned: state.reaperOut ? 1 : 0 };
  }
  const cx = spec.at?.x ?? p.x;
  const cz = spec.at?.z ?? p.z;
  const points = resolveSpawnPoints(g, cx, cz, spec);
  const placed: Array<{ x: number; z: number }> = [];
  for (const pt of points) {
    const zz = makeDebugEnemy(spec.kind, pt.x, pt.z, spec.ztype);
    if (!zz) continue;
    zz.aggro = spec.aggro ?? true;
    const hp = spec.hp;
    if (hp !== undefined) {
      zz.hp = hp;
      zz.maxHp = Math.max(zz.maxHp ?? hp, hp); // maxHp is optional on Zombie
    }
    state.zombies.push(zz);
    placed.push({ x: pt.x, z: pt.z });
  }
  return { spawned: placed.length, requested, kind: spec.kind, points: placed };
}

/** Spawn one enemy of any kind next to the player, bypassing the level gates. */
export function debugSpawnEnemy(kind: EnemyKind, count = 1): void {
  debugSpawn({ kind, count, ring: count > 1 ? 2 : 0 });
}

/** Kill every living enemy through the normal death path (FX + score fire). */
export function debugKillAll(): void {
  for (const z of [...state.zombies]) {
    if (z.mode !== "dead") damageZombie(z, 9999, 0, 0, 0, true); // force: bypass the momentum gates
  }
  // Kill All can now actually kill the Death Dealer (it is immune to everything
  // else by design), so the one-per-floor latch has to be released or the Reaper
  // button silently does nothing for the rest of the floor. debugClearEnemies
  // already did this; forcing the gates made Kill All need it too.
  state.reaperOut = false;
}

/** Yank every enemy (and corpse) off the floor instantly — no FX, no score. */
export function debugClearEnemies(): void {
  for (const z of state.zombies) state.scene?.remove(z.sprite.mesh);
  state.zombies.length = 0;
  state.reaperOut = false; // let the reaper be re-summoned after a clear
}

/** Yank non-boss adds off the floor instantly — keeps the boss. */
export function debugClearAdds(): void {
  const bosses = [];
  for (const z of state.zombies) {
    if (z.boss) {
      bosses.push(z);
    } else {
      state.scene?.remove(z.sprite.mesh);
    }
  }
  state.zombies = bosses;
}

// ── SKILLS & ABILITIES, without the wallet ───────────────────────────────────
//
// The MENU already sells every node and every ability rank, correctly gated on
// XP, skill points and prerequisites (gui/screens/menu.ts). That is the game;
// these are not. The console's job is the thing the menu structurally cannot
// do — hand you one specific rule RIGHT NOW so it can be looked at, and take it
// back again so the before/after is one keypress apart.
//
// Two consequences worth stating, because they are what make these safe to add:
//
//  · They spend NOTHING. `state.skillPoints` is untouched, so a debug poke does
//    not quietly change what the menu would let you buy next.
//  · They go through the same READ path the game does — `skillAgg()` and
//    `unlockedAbilities()` — by writing `state.skillRanks` / `abilityRanks` and
//    invalidating the memo. Nothing here fakes an effect downstream, so what
//    you see after a poke is what a real run with that build would do.

/**
 * Top the mana pool up to its current maximum, so the next cast is affordable.
 *
 * The pool lives on the PLAYER (`p.mana`), not on state — it is a per-life
 * resource like hp, and `playerManaMax()` is where the tree's Mana Well ranks
 * and Blood Price's −30 are already folded in, so filling to it cannot overfill
 * past what the HUD bar is drawing.
 */
export function debugFillMana(): void {
  const p = state.player;
  if (!p) return;
  p.mana = playerManaMax();
  state.hudDirty = true;
}

/**
 * Unlock an ability and BIND it to Q, sliding whatever was on Q over to E.
 *
 * The slide is deliberate: clicking two abilities in a row leaves exactly those
 * two on the cast bar, which is the comparison you actually want ("this one, and
 * the one I was just using"). Binding to the first EMPTY slot instead would let
 * a full bar swallow the click and do nothing visible.
 *
 * The grant goes into `state.unlockedAbilities` — the same list the two default
 * abilities live in — so it survives a floor change and reads identically to a
 * tree unlock everywhere downstream.
 */
export function debugGiveAbility(id: AbilityId): void {
  if (!state.unlockedAbilities.includes(id)) state.unlockedAbilities.push(id);
  const slots = state.abilitySlots;
  if (slots[0] !== id) {
    // Unconditional, which makes this a SWAP when the ability was already on E
    // rather than a clone onto both keys — the same rule the menu's `assign`
    // follows. Guarding the slide with `if (slots[1] !== id)` looked more
    // careful and did the opposite: re-binding the ability sitting on E left it
    // on Q *and* E, and a duplicated binding is two buttons for one cooldown.
    slots[1] = slots[0];
    slots[0] = id;
  }
  state.abilityCd[id] = 0; // bound READY — a fresh binding on cooldown is a dead button
  state.hudDirty = true;
}

/**
 * Cycle an ability's rank 0 → 1 → 2 → 3 → 0, free.
 *
 * A cycle rather than a "+1", because the interesting rank is 2 — where each
 * ability gains an extra RULE (a planted rod, a ring of frost runes, a tar
 * core) rather than a bigger number. Judging a rule means seeing the cast with
 * and without it, and wrapping back to 0 is what makes that two clicks instead
 * of a reload.
 */
export function debugCycleAbilityRank(id: AbilityId): number {
  const next = (state.abilityRanks[id] ?? 0) + 1;
  state.abilityRanks[id] = next > ABILITY_RANK_MAX ? 0 : next;
  state.hudDirty = true;
  return state.abilityRanks[id];
}

/**
 * Cycle a tree node's rank 0 … maxRank → 0, free, ignoring prerequisites.
 *
 * ── WHY THIS DOES NOT PUSH INTO `state.unlockedAbilities` ──
 * `spendSkillPoint` does, and it is right to: a purchase is permanent, so
 * surfacing the unlock immediately costs nothing. Here it would be a one-way
 * door — cycling `unlocktimecrawl` back to 0 would leave Time Crawl castable
 * forever, and a console whose OFF state is not actually off is worse than no
 * console. So the unlock is left to flow from `skillAgg().unlocked`, which is
 * derived from the ranks and therefore reverses with them, and
 * `syncAbilitySlots()` drops any Q/E binding that just lost its node.
 */
export function debugCycleSkillRank(id: SkillId): number {
  const def = SKILLS[id];
  if (!def) return 0;
  const next = ((state.skillRanks[id] ?? 0) + 1) % (def.maxRank + 1);
  if (next === 0) delete state.skillRanks[id];
  else state.skillRanks[id] = next;
  invalidateSkillAgg();
  syncAbilitySlots();
  state.hudDirty = true;
  return next;
}

/**
 * Max every non-keystone node and every ability rank in one press — the "make
 * the knight strong so I can look at the thing under test" button.
 *
 * KEYSTONES ARE SKIPPED, by `isKeystone` rather than by an id list. All three
 * are rule changes with real drawbacks (−30 max mana, a floor that burns YOU,
 * mana that no longer regenerates), and switching them on behind a button
 * labelled "all skills" is how you end up debugging the flag instead of the
 * game. Each keystone has its own row in the console, which is where a rule you
 * are choosing to test belongs.
 */
export function debugMaxSkills(): void {
  for (const id of SKILL_IDS) {
    const def = SKILLS[id];
    if (isKeystone(def)) continue;
    state.skillRanks[id] = def.maxRank;
  }
  for (const id of ABILITY_IDS) state.abilityRanks[id] = ABILITY_RANK_MAX;
  invalidateSkillAgg();
  state.hudDirty = true;
}

/**
 * The console's skill/ability verbs, as a slice of the panel's action object.
 *
 * ── WHY THESE ARE NOT ON `DebugActions` ──
 * `DebugActions` is the contract CORE fills in, and it exists for the verbs that
 * need core's private lifecycle — `descend()`, `startLevel()`, `freshWeapon()`
 * into the live weapon slot. Not one of these six does. They read and write
 * `state` and go through `skill-runtime`, which is why they live in this module
 * at all, so routing them through `launchDungeonGame` would have been sixteen
 * lines of pure ceremony in the one file this subtree keeps on a line ratchet.
 * `debug-panel.ts` mixes them in where it builds the screen instead.
 *
 * The ids arrive as strings because the panel's rosters are `readonly string[]`
 * — one chip renderer serves potions, weapons, monsters and skills alike — so
 * this is also the boundary that turns a string back into a typed id or drops
 * it, the same shape as core's `giveWeapon` / `applyPotion` guards.
 */
export interface SkillDebugActions {
  /** Refill the Q/E mana pool to its current maximum. */
  fillMana(): void;
  /** Unlock an ability and bind it to Q (whatever was on Q slides to E). */
  giveAbility(id: string): void;
  /** Cycle one ability's rank 0→1→2→3→0, free — rank 2 is where a rule lands. */
  cycleAbilityRank(id: string): void;
  /** Cycle one tree node's rank 0…max→0, free, prerequisites ignored. */
  cycleSkillRank(id: string): void;
  /** Max every non-keystone node + every ability rank. */
  maxSkills(): void;
  /** Drop every tree rank and ability rank — the other half of an A/B. */
  clearSkills(): void;
}

export function debugSkillActions(): SkillDebugActions {
  const ability = (id: string): AbilityId | null => (ABILITY_IDS.includes(id as AbilityId) ? (id as AbilityId) : null);
  return {
    fillMana: debugFillMana,
    giveAbility: (id) => {
      const a = ability(id);
      if (a) debugGiveAbility(a);
    },
    cycleAbilityRank: (id) => {
      const a = ability(id);
      if (a) debugCycleAbilityRank(a);
    },
    cycleSkillRank: (id) => {
      if (id in SKILLS) debugCycleSkillRank(id);
    },
    maxSkills: debugMaxSkills,
    clearSkills: debugClearSkills,
  };
}

/** Drop every tree rank and ability rank — the other half of an A/B. */
export function debugClearSkills(): void {
  state.skillRanks = {};
  state.abilityRanks = {} as Record<AbilityId, number>;
  invalidateSkillAgg();
  syncAbilitySlots();
  state.hudDirty = true;
}

/**
 * The overlord's reward: a chunk of bonus gold banked instantly, plus a health
 * potion + a gold idol dropped on the floor where it died (so clearing the
 * milestone visibly pays out). Registered with combat via setBossDefeatedHandler.
 */
