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
import { snapCameraTo } from "../camera";
import { levelConfig } from "../constants";
import { resolveSpawnPoints, type DebugSpawnResult, type DebugSpawnSpec } from "../debug-spawn";
import { damageZombie, setBossDefeatedHandler, syncActorMesh } from "../entities/combat";
import { at, tileCenter, worldToTile } from "../maze/generator";
import { nearestOpenTile } from "../maze/nearest-open-tile";
import { ITEM_PAINTS, ZOMBIE_VARIANTS } from "../render/cel-painter";
import { createStaticSprite, type SpriteSheet } from "../render/sprite";
import { RESKIN, makeReskin, makeZombie, spawnKind } from "../spawn/factory";
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
  if (state.spiderSheet) specs.push({ sheet: state.spiderSheet, kind: "spider" });
  if (state.bruteSheet) specs.push({ sheet: state.bruteSheet, kind: "brute" });
  if (state.spitterSheet) specs.push({ sheet: state.spitterSheet, kind: "spitter" });
  if (state.ghostSheet) specs.push({ sheet: state.ghostSheet, kind: "ghost" });
  if (state.batSheet) specs.push({ sheet: state.batSheet, kind: "bat" });
  if (state.slimeSheet) specs.push({ sheet: state.slimeSheet, kind: "slime" });
  // The Wave-B reskins, so the whole roster is inspectable in one ring.
  for (const kind of ["goblin", "pin", "golem", "chomper", "magnet", "webspinner"] as EnemyKind[]) {
    const skin = RESKIN[kind];
    const sheet = skin?.sheet();
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
    const skin = RESKIN[spec.kind];
    if (skin) zz.sprite.mesh.scale.multiplyScalar(skin.scale);
    zz.aggro = true;
    zz.anim.setFacing("S");
    zz.anim.play("walk", { force: true });
    state.zombies.push(zz);
  });
  // Also scatter every potion in a tight ring right around the player, so a
  // small wiggle picks them all up (pickup + effect QA) and the art is visible.
  ["health", "rage", "haste", "shield", "gold", "ballform", "freeze", "multiball", "curveshot", "magnetboots"].forEach((id, i, arr) => {
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
    const sheet = state.zombieVariantSheets[allowed[0]] ?? state.zombieVariantSheets[0] ?? state.zombieSheet;
    return sheet ? makeZombie(sheet, x, z, speed, { kind: "zombie", ztype }) : null;
  }
  if (RESKIN[kind]) return makeReskin(kind, x, z, speed);
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

/**
 * The overlord's reward: a chunk of bonus gold banked instantly, plus a health
 * potion + a gold idol dropped on the floor where it died (so clearing the
 * milestone visibly pays out). Registered with combat via setBossDefeatedHandler.
 */
