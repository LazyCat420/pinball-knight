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
import { loadImportedSheet, importedPaints, sheetPalette } from "./imported-paints";
import type { ActorPaints } from "../engine/render/paint-types";

/** Enough for a whole run's weapon/gear churn without rebuild thrash. */
const CACHE_CAP = 10;

export type SheetConsumer = "dungeon" | "tavern";
const pinned = new Map<SheetConsumer, string>();

let importedKnightPaints: ActorPaints | null = null;
/**
 * The imported sheets' own colours, appended to the shared palette when this
 * actor's atlas is crushed. Null while the knight is purely painted — the
 * painter authors against the shared palette and needs nothing extra.
 */
let importedKnightPalette: number[][] | null = null;

export function setImportedKnightPaintsForTest(paints: ActorPaints | null): void {
  importedKnightPaints = paints;
  if (!paints) importedKnightPalette = null;
}

/**
 * Build options for a knight atlas.
 *
 * ⚠️ THE PALETTE APPLIES EVEN THOUGH MOST FRAMES ARE PAINTED. `resolvePaints`
 * merges imported clips over the painter's, so one atlas holds both, and the
 * appended entries are what keep the imported frames off the shared ramps
 * without taking the shared ramps away from the marble forms. See
 * `SheetBuildOptions.sheetPalette`.
 */
function knightBuildOpts(): { sheetPalette?: number[][] } {
  return importedKnightPalette ? { sheetPalette: importedKnightPalette } : {};
}

/**
 * WHICH SHEET THE PLAYER WEARS. `pinball_knight` unless someone chose another.
 *
 * Read at load like `importedArtEnabled`, and for the same reason: the atlas is
 * palette-locked over the whole sheet, so swapping mid-run would need a rebuild
 * of every cached weapon+look variant. `__lab.playAs("frog")` then RELOAD.
 *
 * This is the ONE thing that stood between a published sheet and being the
 * player: `resolvePaints` already merges imported clips over the painter's, and
 * the painter still authors every ride form (`ball`, the marbles, the ricochet
 * bodies) that no generated sheet can supply — so an arbitrary creature
 * degrades exactly the way the knight's own imported art already does.
 */
const PLAYER_SHEET_KEY = "pinball-knight-player-sheet";
export const DEFAULT_PLAYER_SHEET = "pinball_knight";

/**
 * WHO THE PLAYER MAY BE — the character-select roster.
 *
 * A `sheet` here is a published name under `public/sprites/`, the same namespace
 * `loadImportedSheet` reads. Adding a character is one entry plus its sheet; no
 * `EnemyKind`, no compile-enforced tables, because the player's art is resolved
 * through `resolvePaints` rather than through the monster registries.
 *
 * ⚠️ EVERY ENTRY IS A RESKIN, INCLUDING THE DEFAULT. The painter still authors
 * the ride forms — `ball`, the marbles, the ricochet bodies — that no imported
 * sheet supplies, so an entry only ever replaces the on-foot clips. A character
 * whose sheet lacks `attack` or `death` falls back to the KNIGHT'S art for those
 * clips, which is visible and deliberate: the alternative is a missing frame.
 */
export interface PlayableCharacter {
  sheet: string;
  label: string;
  blurb: string;
}

export const PLAYABLE: readonly PlayableCharacter[] = [
  { sheet: DEFAULT_PLAYER_SHEET, label: "PINBALL KNIGHT", blurb: "THE FULL MOVESET" },
  { sheet: "mario", label: "MARIO", blurb: "HAMMER SWING · NO DEATH CLIP" },
];

export function playerSheetName(): string {
  try {
    return localStorage.getItem(PLAYER_SHEET_KEY) || DEFAULT_PLAYER_SHEET;
  } catch {
    return DEFAULT_PLAYER_SHEET; // blocked storage is not a reason to change the player
  }
}

export function setPlayerSheetName(name: string | null): void {
  try {
    if (name && name !== DEFAULT_PLAYER_SHEET) localStorage.setItem(PLAYER_SHEET_KEY, name);
    else localStorage.removeItem(PLAYER_SHEET_KEY);
  } catch {
    /* blocked storage — the choice simply does not persist */
  }
}

/**
 * CHOOSE A CHARACTER AND HAVE IT TAKE EFFECT, with no page reload.
 *
 * The docblock above says a swap "would need a rebuild of every cached
 * weapon+look variant", and that is true — but it is also exactly the three
 * lines `loadImportedKnightArt` already runs on its own success path. The
 * reload was never load-bearing; it was the cheapest way to reach a state the
 * loader could already produce. So this drops the module's memo and re-enters
 * that path, and the next rAF rebuilds through `resolvePaints`.
 *
 * The DEFAULT sheet is a real choice, not the absence of one. Selecting the
 * knight has to clear the memo too, or picking Mario and then picking the
 * knight back leaves Mario's clips resolved for the rest of the session.
 *
 * Returns whether the chosen sheet actually loaded. A false return means the
 * player is still whoever they were: `loadImportedSheet` resolves to null on
 * any failure, and a caller that reported success anyway would be promising a
 * character the atlas never received.
 */
export async function switchPlayerSheet(name: string): Promise<boolean> {
  if (name === playerSheetName() && importedKnightPaints) return true;
  setPlayerSheetName(name);
  importedKnightPaints = null;
  importedKnightPalette = null;
  // Drop the cached atlases too. They are keyed by weapon+look, NOT by sheet —
  // so without this the next getKnightSheet call hands back the previous
  // character's atlas for an unchanged weapon, and the swap silently no-ops.
  state.playerSheets.clear();
  state.playerArtKey = null;
  pinned.clear();
  return (await loadImportedKnightArt()) !== null;
}

export async function loadImportedKnightArt(): Promise<ActorPaints | null> {
  if (importedKnightPaints) return importedKnightPaints;
  const name = playerSheetName();
  try {
    // S, N, and E are all authored.
    const sheets = (await Promise.all([
      loadImportedSheet(name, "S"),
      loadImportedSheet(name, "N"),
      loadImportedSheet(name, "E"),
    ])).filter((s): s is NonNullable<typeof s> => s !== null);
    if (!sheets.length) return null;
    const paints = importedPaints(sheets);
    if (paints) {
      importedKnightPaints = paints;
      importedKnightPalette = sheetPalette(sheets) ?? null;
      state.playerSheets.clear();
      // Clearing the CACHE is not enough: applyWeaponArt early-returns while
      // the composite weapon+look key matches state.playerArtKey, so the live
      // sprite kept the painter's sheet until the first gear change. Reset the
      // key and the next rAF rebuilds through resolvePaints with these clips.
      state.playerArtKey = null;
      console.info(`[dungeon] player: imported ${name} art loaded`);
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

  const sheet = buildSpriteSheet(resolvePaints(weapon, look), knightBuildOpts());
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
  if (!building) building = { key, build: startSpriteSheet(resolvePaints(weapon, look), knightBuildOpts()) };

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
