/**
 * KNIGHT SHEET CACHE — the ONE place a knight atlas is built or fetched, for
 * both the dungeon player and the walkable-tavern knight.
 *
 * With gear in the cache key the space is 8 weapons × 8 looks = 64 possible
 * sheets (a real run touches ~6-10). Each sheet is a painted+crushed canvas
 * texture (~100 frames), so the cache is LRU-capped and EVICTS WITH DISPOSE —
 * the old weapon-keyed Map leaked textures on principle, it just never had
 * enough keys to matter.
 *
 * Eviction never touches the sheet a live sprite is showing: each consumer
 * ("dungeon" / "tavern") pins the last key it fetched.
 */
import { state } from "../state";
import { buildSpriteSheet, startSpriteSheet, type SheetBuild, type SpriteSheet } from "../engine/render/sprite";
import { makeKnightPaints } from "./cel-painter";
import type { WeaponId } from "../items";
import { lookKey, type KnightLook } from "./knight-look";
import { loadImportedSheet, importedPaints } from "./imported-paints";
import type { ActorPaints } from "../engine/render/paint-types";

/** Enough for a whole run's weapon/gear churn without rebuild thrash. */
const CACHE_CAP = 10;

export type SheetConsumer = "dungeon" | "tavern";
const pinned = new Map<SheetConsumer, string>();

let importedKnightPaints: ActorPaints | null = null;

export function setImportedKnightPaintsForTest(paints: ActorPaints | null): void {
  importedKnightPaints = paints;
}

export async function loadImportedKnightArt(): Promise<ActorPaints | null> {
  if (importedKnightPaints) return importedKnightPaints;
  try {
    // S and N are both authored (the roster sheets pack front and back rows);
    // E is not — importedPaints hands it the S clips by reference, and the
    // engine draws W as E flipped.
    const sheets = (await Promise.all([
      loadImportedSheet("pinball_knight", "S"),
      loadImportedSheet("pinball_knight", "N"),
    ])).filter((s): s is NonNullable<typeof s> => s !== null);
    if (!sheets.length) return null;
    const paints = importedPaints(sheets);
    if (paints) {
      importedKnightPaints = paints;
      state.playerSheets.clear();
      console.info("[dungeon] player: imported pinball_knight art loaded");
    }
    return paints;
  } catch {
    return null;
  }
}

/**
 * Imported clips OVER the painter's, never instead of them.
 *
 * The sheets author the on-foot clips (idle/walk/attack/…). The painter is
 * still the only author of the RIDE forms — `ball`, `steelball`, the six
 * marble bodies, the ricochet forms — and of anything else the sheets skip.
 * Total replacement (`imported ?? painted`) shipped a knight whose `ball`
 * clip resolved to an empty frame list: the animator's `apply()` bails on
 * empty, so entering marble form froze the sprite on its last standing frame.
 * `ball` has no CLIP_FALLBACK entry — nothing downstream catches this.
 */
function resolvePaints(weapon: WeaponId, look: KnightLook): ActorPaints {
  const painted = makeKnightPaints(weapon, look);
  if (!importedKnightPaints) return painted;
  return {
    S: { ...painted.S, ...importedKnightPaints.S },
    N: { ...painted.N, ...importedKnightPaints.N },
    E: { ...painted.E, ...importedKnightPaints.E },
    ...(painted.beats ? { beats: painted.beats } : {}),
  };
}

export function getKnightSheet(weapon: WeaponId, look: KnightLook, consumer: SheetConsumer): SpriteSheet {
  const key = lookKey(weapon, look);
  pinned.set(consumer, key);

  const cached = touch(key);
  if (cached) return cached;

  const sheet = buildSpriteSheet(resolvePaints(weapon, look));
  return commit(key, sheet);
}

/** Cache hit + LRU recency refresh, or null. */
function touch(key: string): SpriteSheet | null {
  const sheet = state.playerSheets.get(key);
  if (!sheet) return null;
  // Refresh recency: Map preserves insertion order, so delete + re-set makes
  // iteration order double as the LRU order.
  state.playerSheets.delete(key);
  state.playerSheets.set(key, sheet);
  return sheet;
}

/**
 * The knight's atlas, WITHOUT ever painting it on a frame the player can see.
 *
 * `applyWeaponArt` runs from the rAF loop and calls this every frame; on a
 * weapon or gear change the old code went straight to `buildSpriteSheet`, which
 * is ~100 crushed frames in one synchronous call. Profiled over a 30 s bot run
 * that was 857 ms of hitch time — the second largest contributor after the
 * monster backfill, and unlike the backfill it landed mid-combat, because gear
 * changes when a cuirass shatters.
 *
 * So a miss starts an incremental build and returns null. The caller keeps
 * drawing the sheet it already has (the previous weapon's) for the handful of
 * frames the paint takes, which is a far better trade than a freeze: the swap
 * animation covers it, and a wrong-sprite frame is worth ~1/60 s of a wrong
 * SILHOUETTE where the alternative is a quarter-second where nothing moves.
 *
 * Returns the sheet on the frame it completes, and on every frame after.
 */
export function requestKnightSheet(
  weapon: WeaponId,
  look: KnightLook,
  consumer: SheetConsumer,
  budgetMs: number,
): SpriteSheet | null {
  const key = lookKey(weapon, look);
  pinned.set(consumer, key);

  const cached = touch(key);
  if (cached) return cached;

  // A different key mid-build (two swaps in quick succession) restarts rather
  // than finishing art nobody asked for any more. The abandoned build's texture
  // is disposed here; nothing has drawn it.
  if (building && building.key !== key) {
    building.build.sheet.texture.dispose();
    building = null;
  }
  if (!building) building = { key, build: startSpriteSheet(resolvePaints(weapon, look)) };

  if (!building.build.step(budgetMs)) return null;
  const done = building.build.sheet;
  building = null;
  return commit(key, done);
}

let building: { key: string; build: SheetBuild } | null = null;

/** Insert into the cache and evict down to the cap. */
function commit(key: string, sheet: SpriteSheet): SpriteSheet {
  state.playerSheets.set(key, sheet);

  if (state.playerSheets.size > CACHE_CAP) {
    const inUse = new Set(pinned.values());
    for (const [k, s] of state.playerSheets) {
      if (state.playerSheets.size <= CACHE_CAP) break;
      if (inUse.has(k)) continue; // never dispose a texture a sprite is showing
      s.texture.dispose();
      state.playerSheets.delete(k);
    }
  }
  return sheet;
}
