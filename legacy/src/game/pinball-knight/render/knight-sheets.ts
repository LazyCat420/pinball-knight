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
import { buildSpriteSheet, type SpriteSheet } from "../engine/render/sprite";
import { makeKnightPaints } from "./cel-painter";
import type { WeaponId } from "../items";
import { lookKey, type KnightLook } from "./knight-look";

/** Enough for a whole run's weapon/gear churn without rebuild thrash. */
const CACHE_CAP = 10;

export type SheetConsumer = "dungeon" | "tavern";
const pinned = new Map<SheetConsumer, string>();

/** Hand-made sprite-forge atlases (public/dungeon/sprites/knight-<id>.*) are
 * not gear-aware, so when one exists it overrides EVERY look of that weapon. */
const handmade = new Map<WeaponId, SpriteSheet>();
export function setHandmadeOverride(weapon: WeaponId, sheet: SpriteSheet): void {
  handmade.set(weapon, sheet);
}

export function getKnightSheet(weapon: WeaponId, look: KnightLook, consumer: SheetConsumer): SpriteSheet {
  const made = handmade.get(weapon);
  if (made) return made;
  const key = lookKey(weapon, look);
  pinned.set(consumer, key);

  let sheet = state.playerSheets.get(key);
  if (sheet) {
    // Refresh recency: Map preserves insertion order, so delete + re-set makes
    // iteration order double as the LRU order.
    state.playerSheets.delete(key);
    state.playerSheets.set(key, sheet);
    return sheet;
  }

  sheet = buildSpriteSheet(makeKnightPaints(weapon, look));
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
