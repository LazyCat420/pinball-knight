/**
 * Sprite atlases — the knight's per-weapon look and the monster roster.
 *
 * Extracted from core.ts. Two related jobs live together here: the knight's
 * sheet is a COMPOSITE key (weapon + worn gear), rebuilt whenever either
 * changes, while the monster atlases are built once per session and cached on
 * `state`. Both are "which pixels does this actor draw with", so splitting them
 * would just mean two files importing the same painters.
 */
import { CARDS } from "../cards";
import { type WeaponId } from "../items";
import { ZOMBIE_VARIANTS, makeZombiePaints, withRecoil, type ActorPaints } from "../render/cel-painter";
import { lookFromGear } from "../render/knight-look";
import { renderKnightPortrait } from "../render/knight-portrait";
import { getKnightSheet, requestKnightSheet, loadImportedKnightArt, playerArtKey } from "../render/knight-sheets";
import { bakeTintedSheet, buildSpriteSheet, startSpriteSheet, type SheetBuild, type SheetBuildOptions, type SpriteSheet } from "../engine/render/sprite";
import { syncAbilitySlots } from "../skill-runtime";
import { activeWeapon, state, type EnemyKind } from "../state";
import { KIND_SKIN } from "../spawn/kind-skin";
import { KIND_IDS } from "../bestiary";
import { SHEET_PAINTERS } from "../render/sheet-painters";
import { authoredDirs, importedPaints, loadImportedSheet, sheetPalette, type ImportedSheet } from "../render/imported-paints";
import { sheetCoverage } from "../tools/sprite-forge/build-plan";
import { _clearPortraitCache } from "../render/monster-portrait";
import type { Dir } from "../engine/render/paint-types";

/** The facings a sheet may author. W is drawn as a flipped E. */
const DIRS: Dir[] = ["S", "N", "E"];

/**
 * Paint budget per frame for a knight re-dress, inside the rAF loop.
 *
 * This one genuinely spends frame time — it is a VISIBLE swap the player is
 * waiting on, so it cannot wait for idle the way the monster backfill can. Kept
 * to 2 ms because the frame it is added to already costs ~12 ms: 6 ms was
 * measured pushing p95 past the 16.7 ms budget, which is the same mistake as
 * doing it all at once, just quieter.
 */
const WEAPON_ART_SLICE_MS = 2;

export function playerSheetFor(id: WeaponId): SpriteSheet {
  return getKnightSheet(id, lookFromGear(state.gear), "dungeon");
}

/** Make the sprite match the active hand AND the worn gear. Runs every frame;
 * cheap no-op when the composite key hasn't changed. Because gear is part of
 * the key, a helmet pickup, an armory purchase, or a cuirass shattering
 * mid-fight all re-dress the knight with no extra hooks. */
export function applyWeaponArt(): void {
  const id = activeWeapon().id;
  const look = lookFromGear(state.gear);
  // `playerArtKey`, not `lookKey`: the CHARACTER is part of what is on screen,
  // and a key that omits it reports a knight atlas as current after the player
  // has chosen Mario. See the docblock on playerArtKey.
  const key = playerArtKey(id, look);
  if (key === state.playerArtKey || !state.player) return;
  // Paint at most WEAPON_ART_SLICE_MS of the new atlas per frame and keep the
  // current one on screen until it is finished — see requestKnightSheet. A miss
  // used to build the whole thing here, inside the rAF loop.
  const sheet = requestKnightSheet(id, look, "dungeon", WEAPON_ART_SLICE_MS);
  if (!sheet) return;
  state.player.sprite.setSheet(sheet);
  state.player.silhouette?.syncMap();
  state.playerArtKey = key;
  // ── SKILL CARDS (cards.ts grantsAbility) ──
  // A card-granted ability lives on the weapon in HAND, so the hand changing can
  // invalidate a Q/E binding. Hooked HERE deliberately: this function is already
  // the one funnel every hand change passes through (pickup, swap, break, retry),
  // and the alternative — patching all five call sites — is a bug waiting for the
  // sixth one to be added. The key check above means this only fires on an actual
  // change, not every frame.
  if (syncAbilitySlots()) state.hudDirty = true;
}

/** The paperdoll painter handed to the menu — the live mirror of the knight. */
export function paintMenuPortrait(canvas: HTMLCanvasElement): void {
  renderKnightPortrait(canvas, activeWeapon().id, lookFromGear(state.gear));
}

/**
 * Every monster atlas goes through `withRecoil`, which fills in the `wake` and
 * `stumble` telegraph clips for any family that has not hand-posed them.
 *
 * It is applied HERE, at the one place every monster sheet is built, rather
 * than inside each `make*Paints` (fourteen edits, and the fifteenth monster
 * would be the one that forgot) or inside `buildSpriteSheet` (which the KNIGHT
 * also goes through, and the knight is never staggered — it would be nine dead
 * cells on the atlas that is already closest to the texture ceiling).
 */
/**
 * Every monster atlas is capped at 20 distinct palette entries.
 *
 * 20, not the 16 the SNES-era guidance suggests, because the number was
 * MEASURED rather than borrowed: the cleanest actor in this roster censuses 15
 * entries and the one nobody complains about sits at 18, while the painters
 * themselves declare 13-24. A 16 cap would evict colours the busiest creatures
 * genuinely author; 20 removes only what the downscale invented on top.
 */
const LOCK = { lockEntries: 20 };

/**
 * A creature's own palette entries, when its imported sheets declared any.
 *
 * Keyed by SheetKey and populated in `applyImportedArt`, so a monster that is
 * still painted has no entry and builds against the shared palette alone. See
 * `SheetBuildOptions.sheetPalette`.
 */
const importedPalettes = new Map<SheetKey, number[][]>();

function buildOpts(key?: SheetKey): SheetBuildOptions {
  const pal = key ? importedPalettes.get(key) : undefined;
  return pal ? { ...LOCK, sheetPalette: pal } : LOCK;
}

function monsterSheet(paints: ActorPaints, key?: SheetKey): SpriteSheet {
  return buildSpriteSheet(withRecoil(paints), buildOpts(key));
}

/** The same rule, for the incremental path. Both go through `withRecoil`. */
function startMonsterSheet(paints: ActorPaints, key?: SheetKey): SheetBuild {
  return startSpriteSheet(withRecoil(paints), buildOpts(key));
}

/**
 * ATLAS BUILD ORDER — why this file stopped building all 22 up front.
 *
 * It used to say "a handful of atlases is cheap". It was, once; it is 22 now,
 * and `buildMonsterSheets()` was measured as ONE synchronous 6,075 ms task at
 * `launchDungeonGame` — 824 frames, each a 128 px vector paint downscaled to
 * 72×72 and palette-snapped. That is the freeze in the "browser lags very bad"
 * report (LOAD_PLAN.md §3).
 *
 * The roster is now split three ways:
 *
 *   1. What floor 1 can actually spawn, built synchronously (`ESSENTIAL`).
 *   2. Everything else, backfilled one atlas per idle callback, so a later
 *      floor's monsters are warm without ever blocking a frame.
 *   3. Anything the backfill hasn't reached yet, built on demand by `sheetFor`.
 *
 * (3) is what makes this safe rather than a race: no spawn path can outrun the
 * idle queue, because asking for a sheet builds it. The spawn table already
 * reaches every atlas through a THUNK (`spawn/factory.ts` EXPANSION_SKIN /
 * RESKIN, `() => state.sheets.spider`), so the call sites did not have to change
 * — they just have to go through `sheetFor` now instead of reading the field.
 *
 * The cache IS the existing `state.*Sheet` fields, deliberately. `state.ts`
 * reset and `dispose.ts` teardown already null every one of them; a second,
 * separate memo would be a fresh way to leak 22 atlases across a floor change.
 */
export type SheetKey =
  | "zombie" | "spider" | "brute" | "warden" | "spitter" | "ghost" | "bat" | "slime" | "boss"
  | "goblin" | "pin" | "golem" | "chomper" | "magnet" | "webspinner" | "sporeling"
  | "hound" | "jester" | "croaker" | "rotortail" | "stiltneck" | "fish_feet"
  | "necromancer" | "crystalback" | "mimic"
  | "reaper" | "broodmother" | "overlord" | "archivist" | "dragon";

/**
 * EnemyKind → the atlas that kind draws with, DERIVED, not re-listed.
 */
const SHEET_KEYS = new Set<string>([
  "zombie", "spider", "brute", "warden", "spitter", "ghost", "bat", "slime", "boss",
  "goblin", "pin", "golem", "chomper", "magnet", "webspinner", "sporeling",
  "hound", "jester", "croaker", "rotortail", "stiltneck", "fish_feet",
  "necromancer", "crystalback", "mimic", "reaper", "broodmother", "overlord", "archivist", "dragon",
]);

/** The atlas key a kind draws with, or undefined when it has no own/borrowed one. */
export function sheetKeyForKind(kind: EnemyKind): SheetKey | undefined {
  const borrowed = KIND_SKIN[kind]?.sheetKey;
  if (borrowed) return borrowed;
  return SHEET_KEYS.has(kind) ? (kind as SheetKey) : undefined;
}

/**
 * The same relation as a table, for callers that iterate rather than ask.
 * Exhaustive by construction: every EnemyKind appears, mapping to a key or to
 * undefined, so a new kind cannot quietly go missing from it.
 */
export const SHEET_KEY_BY_KIND: Record<string, SheetKey> = Object.fromEntries(
  KIND_IDS
    .map((k) => [k, sheetKeyForKind(k)] as const)
    .filter((e): e is readonly [EnemyKind, SheetKey] => e[1] !== undefined),
) as Record<string, SheetKey>;

/**
 * The BUILT atlas a kind wears, tint BAKED in when it has one.
 *
 * Lives here rather than in the spawner because it is an atlas-resolution
 * question, and because `rebuild()` below needs it: a re-emitted base sheet
 * makes every baked copy of it stale.
 *
 * ── WHY THE TINT IS BAKED AND NOT `setTint` ────────────────────────────────
 *
 * This used to `setTint(skin.tint)` — a live GPU multiply that pushed every
 * palette-exact texel OFF the palette, for the screen quantizer to reassign
 * per pixel (the sapper read as flat yellow mush, the necromancer as blood
 * red). The tint is now baked into a palette-snapped copy of the atlas once
 * per kind, so a borrowed-art monster is as palette-true as a hand-painted
 * one. `baseTint` stays unset on purpose: the dye lives in the art now, so a
 * damage flash restores to null instead of re-applying it.
 */
export function skinSheet(kind: EnemyKind): SpriteSheet | null {
  const skin = KIND_SKIN[kind];
  if (!skin) return null;
  const key = sheetKeyForKind(kind);
  if (!key) return null;
  if (skin.tint === undefined) return sheetFor(key);
  const cached = state.expansionSheets[kind];
  if (cached) return cached;
  const base = sheetFor(key);
  if (!base) return null;
  const baked = bakeTintedSheet(base, skin.tint);
  state.expansionSheets[kind] = baked;
  return baked;
}

/**
 * key → the painter that draws its atlas.
 *
 * Each row used to carry a hand-written `get`/`set` closure pair onto a
 * dedicated `state.<kind>Sheet` field. Those fields are now one map
 * (`state.sheets`), so the accessor pair is `state.sheets[key]` for every key
 * and there was nothing left to write per row — sixty-six lines of closure
 * became two subscript expressions in `sheetFor` and `rebuild` below. What was
 * left, the painter column, is shared with the census; see
 * `render/sheet-painters.ts` for why it lives outside both.
 */
const BUILDERS = SHEET_PAINTERS;

/**
 * Built before the first playable frame.
 *
 * Floor 1's spawn gates (`constants/enemies.ts`, `constants/pinball.ts`) admit
 * goblin, pin, spider, sporeling and hound — and every one of those now owns a
 * bespoke atlas, so every one of them is listed here. (`hound` used to be a
 * TINTED RESKIN of the spider sheet and needed none; it graduated to its own
 * art in render/monsters/hound.ts.) Everything else is gated at level ≥ 2 and
 * has a whole floor's worth of idle time to arrive.
 *
 * ⚠️ If a `*_FROM_LEVEL` is ever lowered to 1, add its key here. Getting that
 * wrong is not a crash — `sheetFor` will build it on the spawn — it just moves
 * that one atlas back onto a gameplay frame. `sporeling` (SPORELING_FROM_LEVEL
 * = 1) shipped in BACKFILL and was exactly that miss; the registry-drift check
 * in scripts/hooks now cross-reads the FROM_LEVEL constants against this list.
 */
const ESSENTIAL: SheetKey[] = ["spider", "goblin", "pin", "sporeling", "hound"];

/**
 * Build order for the idle backfill: roughly the order the floor gates admit
 * them (chomper/ghost at 2, the level-3 block, then 4 and 5).
 *
 * `boss` is deliberately NOT here. Nothing spawns it — the only reader is the
 * dev art-QA hook in dev/window-hooks.ts, and the mini-boss the game actually
 * fights uses `reaperSheet()`, which has always been lazy. Warming it would be
 * ~275 ms spent on an atlas no player ever sees. `sheetFor("boss")` still
 * builds it for the hook.
 */
const BACKFILL: SheetKey[] = ["ghost", "chomper", "jester", "croaker", "brute", "slime", "bat", "rotortail", "golem", "magnet", "spitter", "webspinner", "stiltneck", "fish_feet"];

/**
 * Get an atlas, building it if the backfill hasn't reached it yet.
 *
 * Every spawn path goes through this, so no monster can appear without its art
 * regardless of how far the idle queue got — including an atlas the backfill is
 * halfway through, which is finished on the spot rather than handed over with
 * transparent cells in it.
 */
export function sheetFor(key: SheetKey): SpriteSheet {
  const hit = state.sheets[key];
  if (hit) return hit;
  const partial = inFlight.get(key);
  if (partial) {
    inFlight.delete(key);
    if (current?.key === key) current = null;
    const s = partial.finish();
    state.sheets[key] = s;
    return s;
  }
  const built = monsterSheet(paintsFor(key), key);
  state.sheets[key] = built;
  return built;
}

/**
 * IMPORTED ART OVERRIDES, once loaded. Empty until `applyImportedArt` resolves.
 *
 * Consulted through `paintsFor` rather than replacing `BUILDERS[key]`,
 * because the painter has to stay reachable: it is the fallback when a sheet is
 * missing, when its dimensions no longer match its manifest, and when the
 * player turns imported art off.
 */
const imported = new Map<SheetKey, ActorPaints>();

/**
 * The art a key builds with: imported clips OVER the painter's, never INSTEAD
 * of them.
 *
 * ── THE FALLBACK THAT WASN'T ────────────────────────────────────────────────
 *
 * This was `imported.get(key) ?? BUILDERS[key]()` — all or nothing. The
 * brute's commit (55f98e2) shipped a sheet with NO death row on the stated
 * grounds that "a clip an imported sheet does not author falls through to the
 * PAINTER by design". That is true of the PLAYER, whose `resolvePaints`
 * (render/knight-sheets.ts) merges per clip. It was never true here, and the
 * two paths having opposite semantics is exactly why the belief survived
 * review: the sentence is correct, about the other file.
 *
 * What the brute actually got: `killZombie` plays `death`, the imported paints
 * have no `death`, `death` has no CLIP_FALLBACK entry (only the four telegraph
 * clips do), so `Animator.indices()` returns empty and `apply()` bails. The
 * creature FREEZES on whichever frame it was mid-stride on and fades out as a
 * statue. Silent, and invisible unless you kill one and watch it.
 *
 * Merging per clip fixes every partial import at once rather than per sheet,
 * and it is what makes a partial import a legitimate way to ship: author the
 * clips the generator got right, keep the painter for the rest.
 *
 * ⚠️ AND IT IS STILL A COSTUME CHANGE, because the two sides are different art.
 * The brute kept its hand-painted death for exactly as long as it took someone
 * to watch one die: a green orc that collapses as the old grey armoured brute.
 * "Falls through to the painter" is not a neutral default when the painter and
 * the sheet disagree about what the creature IS. Its death and stumble rows
 * were generated and published on 2026-08-07; a sheet that omits a clip is a
 * work item, not a shipping state.
 *
 * MERGED PER DIRECTION, because a facing is the unit an import is partial in:
 * a sheet that authors S only must not lose the painter's E walk. (Note that
 * `importedPaints` has already fanned one authored facing out to all three by
 * reference, so in practice `imported[E]` is populated even for an S-only
 * sheet — but that is its policy, not ours to assume.)
 *
 * `beats` comes from the PAINTER: an imported sheet cannot declare one
 * (`SheetManifest` has no such field), so taking the imported side's would
 * always be dropping the painter's authored cadence for `undefined`.
 */
export function paintsFor(key: SheetKey): ActorPaints {
  const painted = BUILDERS[key]();
  const art = imported.get(key);
  if (!art) return painted;
  return {
    S: { ...painted.S, ...art.S },
    N: { ...painted.N, ...art.N },
    E: { ...painted.E, ...art.E },
    ...(painted.beats ? { beats: painted.beats } : {}),
  };
}

/** Idle handle, so a teardown mid-backfill doesn't paint into a dead session. */
let backfillHandle: number | null = null;
/** Atlases the backfill has started but not finished. See `sheetFor`. */
const inFlight = new Map<SheetKey, SheetBuild>();
let current: { key: SheetKey; build: SheetBuild } | null = null;

/**
 * Build the atlases the first floor needs, then queue the rest for idle time.
 *
 * Synchronous cost is the zombie variants plus ESSENTIAL — measured target is
 * no single task over 200 ms, versus the 6,075 ms this replaced.
 */
export function buildMonsterSheets(): void {
  // A small pool of cosmetic zombie variants (ripped rags, gore, stumps, tone)
  // so a horde doesn't read as clones. Each spawn picks one by seed. These are
  // not deferrable: floor 1 IS zombies, and a horde with no art is the one case
  // the on-demand path cannot hide.
  state.zombieVariantSheets = ZOMBIE_VARIANTS.map((v) => monsterSheet(makeZombiePaints(v)));
  state.sheets.zombie = state.zombieVariantSheets[0]; // legacy single-sheet handle
  for (const key of ESSENTIAL) sheetFor(key);
  startBackfill();
  // Load knight imported art on startup
  void loadImportedKnightArt();
}

/**
 * SheetKey → the sheet name under `public/sprites/`, for kinds whose art can
 * come from the forge instead of a painter.
 *
 * Both entries are RESKINS of monsters that already exist, deliberately. A new
 * `EnemyKind` costs nine compile-enforced `Record<EnemyKind,X>` tables plus the
 * registries `registry-drift.mjs` covers, none of which has anything to do with
 * whether imported art is viable. Reskinning isolates the art question, and it
 * gives a direct comparison: both painters were built FROM these exact sheets
 * as shape specs (see the headers of render/monsters/jester.ts and
 * rotortail.ts), so painted and imported are the same creature drawn two ways.
 */
// Exported for the forge library route: the panel groups art by SHEET name
// but labels it with the game's kind — this map is that bridge, and a copy
// of it in the forge would be the two-writers drift all over again.
export const IMPORTED_ART: Partial<Record<SheetKey, string>> = {
  brute: "brute",
  jester: "jester",
  rotortail: "crawler",
  croaker: "croaker",
  fish_feet: "fish_feet",
  zombie: "zombie",
  slime: "slime",
  goblin: "goblin",
  spider: "spider",
  spitter: "demon",
  sporeling: "sporeling",
  chomper: "chomper",
  warden: "warden",
  necromancer: "necro",
  crystalback: "crystalback",
  mimic: "mimic",
  ghost: "ghost",
  bat: "bat",
  golem: "golem",
  magnet: "magnet",
  webspinner: "webspinner",
  hound: "hound",
  pin: "pin",
  reaper: "reaper",
  broodmother: "broodmother",
  overlord: "overlord",
  archivist: "archivist",
  dragon: "dragon",
  boss: "overlord",
};


/**
 * `stiltneck` is deliberately ABSENT, and its sheet still ships.
 *
 * It was listed here for weeks and never once drew: its published rows were
 * `walk/attack/stumble/death`, `importedPaints` requires an `idle`, and a null
 * return is silent by design. So "remove it" costs nothing that was on screen.
 *
 * The sidecar now splits its first band into idle+walk, so the import WORKS —
 * and `ab.test.ts` measured what it looks like: isolated 48.4% against the
 * painter's 29.5%, the worst margin of the five pairs, and `work/ab-stiltneck.png`
 * shows why. The figure comes through thin and speckled where the painter is
 * bold. The painter was authored from this sheet as a shape spec and is simply
 * the better rendering of it. Re-list it here if the sheet is ever re-authored
 * at a size this crush can hold.
 */

/** Player toggle, read at load. `__lab.imported(false)` then reload to compare. */
const IMPORTED_KEY = "pinball-knight-imported-art";

export function importedArtEnabled(): boolean {
  try {
    return localStorage.getItem(IMPORTED_KEY) !== "0";
  } catch {
    return true; // blocked storage is not a reason to change how the game looks
  }
}

/**
 * Load imported sheets and swap them in.
 *
 * ── WHY THIS IS NOT AWAITED AT BOOT ─────────────────────────────────────────
 *
 * `launchDungeonGame` is synchronous on purpose — boot/renderer.ts explains
 * that making it async would silently reorder its callers' teardown — and the
 * loop already has a `rendererReady` gate for work that has not arrived yet.
 * Blocking the first frame on a fetch would also hold the loop without drawing
 * the loading screen, which this repo has now done twice.
 *
 * So the painters build first and imported art REPLACES them when it lands.
 * The end state is deterministic (imported always wins once loaded) and there
 * is never a frame with a missing atlas — the failure mode of loading first
 * would have been an invisible monster.
 *
 * ── WHY IT IS ALSO SPLIT IN TWO ─────────────────────────────────────────────
 *
 * Not awaited is not the same as not blocking. The `await`s below are fetches;
 * everything between them — `importedPaints`, `sheetPalette`, `rebuild` — is
 * synchronous canvas work, and it is ONE TASK PER KIND of roughly a second. On
 * braindeadbot.com those six tasks land squarely on top of the title intro,
 * which rendered 4 frames in 2.4 seconds while one of them ran.
 *
 * The player's own art is cheap and wanted early. The monsters are the
 * expensive half and nothing on screen before the lobby draws one, so the
 * caller gets to say WHEN — `core.ts` runs it after the title sequence, and
 * every entry that skips the sequence (`?no-intro=1`, `?autostart=1`, the
 * playtest bot) reaches the same call immediately, because they all arrive
 * through the intro's `onDone`.
 */
export async function applyImportedArt(): Promise<void> {
  if (!importedArtEnabled()) return;
  await loadImportedKnightArt();
  await applyImportedMonsterArt();
}

let applyingMonsters = false;
let appliedMonsters = false;

export function resetImportedMonsterArtForTest(): void {
  applyingMonsters = false;
  appliedMonsters = false;
}

/** The expensive half — see the note above for why it is the caller's to time. */
export async function applyImportedMonsterArt(): Promise<void> {
  if (!importedArtEnabled() || applyingMonsters || appliedMonsters) return;
  applyingMonsters = true;
  try {
    for (const [key, name] of Object.entries(IMPORTED_ART) as [SheetKey, string][]) {
      const loaded = (await Promise.all(DIRS.map((d) => loadImportedSheet(name, d)))).filter(
        (s): s is ImportedSheet => s !== null,
      );
      if (!loaded.length) continue;
      const paints = importedPaints(loaded);
      if (!paints) continue;
      imported.set(key, paints);
      const pal = sheetPalette(loaded);
      if (pal) importedPalettes.set(key, pal);
      _clearPortraitCache();
      const cov = sheetCoverage(loaded.map((s) => s.manifest));
      console.info(
        `[dungeon] ${key}: imported art from ${loaded.length} sheet(s) ` +
          `[${authoredDirs(loaded).join("/")}]${loaded.length < 3 ? " — other facings reuse it" : ""}\n` +
          `           coverage: ${cov.summary}` +
          (cov.clips.missing.length ? ` (${cov.clips.missing.join("/")} fall through to the painter)` : ""),
      );
      rebuild(key);
      // Yield to frame loop between monster rebuilds
      await new Promise((r) => setTimeout(r, 0));
    }
    appliedMonsters = true;
  } finally {
    applyingMonsters = false;
  }
}

/**
 * Rebuild an atlas that was already built, and re-point anything drawing it.
 *
 * A sprite holds the SpriteSheet it was created with, so replacing the cached
 * atlas is not enough — a jester already on the floor would keep drawing the
 * painted texture until it died. `setSheet` is the same call `applyWeaponArt`
 * uses for a knight re-dress. (Only the player carries an occlusion silhouette,
 * so there is no second map to re-sync here.)
 */
function rebuild(key: SheetKey): void {
  _clearPortraitCache();
  inFlight.delete(key);
  if (current?.key === key) current = null;
  const sheet = monsterSheet(paintsFor(key), key);
  state.sheets[key] = sheet;
  if (key === "zombie") {
    state.zombieVariantSheets = [sheet];
  }
  // Every actor wearing this atlas takes the new one. A kind that BORROWS it
  // under a dye needs its baked copy dropped first, or it would be handed the
  // raw base and lose its colour — which is what made this loop skip the eight
  // borrowed kinds rather than serve them wrong.
  for (const z of state.zombies) {
    if (sheetKeyForKind(z.kind) !== key) continue;
    if (z.mode === "dead") continue; // Never clobber a corpse or active death animation in progress
    if (KIND_SKIN[z.kind]?.tint !== undefined) {
      state.expansionSheets[z.kind]?.texture.dispose();
      delete state.expansionSheets[z.kind];
      const rebaked = skinSheet(z.kind);
      if (rebaked) z.sprite.setSheet(rebaked);
    } else {
      z.sprite.setSheet(sheet);
    }
  }
}

/**
 * Ceiling on one backfill slice, even when the browser offers more.
 *
 * `requestIdleCallback` will hand out up to 50 ms, which is three frames. The
 * deadline is the right input — it is the browser's own answer to "how much of
 * this frame is spare" — but it is a permission, not a target, and taking all
 * of it is how a "background" task becomes a stutter.
 */
const BACKFILL_SLICE_CAP_MS = 3;
/** Below this the callback is not worth the wake-up; wait for a better frame. */
const BACKFILL_SLICE_MIN_MS = 1;

/**
 * Warm the remaining atlases a SLICE at a time.
 *
 * ── ONE ATLAS PER CALLBACK WAS STILL TOO MUCH ──
 *
 * This used to build a whole atlas per idle callback, on the reasoning that a
 * batch would blow through `requestIdleCallback`'s advisory deadline. One
 * already did: an atlas was ~275 ms of paint, and rIC never offers more than
 * 50 ms, so every single callback overran by 5x and landed as the long task it
 * was written to avoid. Profiled over a 30 s bot run (scripts/lag-profile.mjs),
 * this path — `step › sheetFor › monsterSheet › buildSpriteSheet` — was 2,046 ms
 * of hitch time, the largest single contributor to the game's frame-pacing tail.
 *
 * So the unit of work is a slice of FRAMES, not an atlas, and the size of the
 * slice comes from `deadline.timeRemaining()` — the browser's own answer to how
 * much of this frame is spare — capped, because rIC's 50 ms allowance is three
 * frames. A partial atlas is never handed out (`sheetFor` finishes it first).
 */
function startBackfill(): void {
  stopSheetBackfill();
  const queue = [...BACKFILL];
  /** The slice this callback may spend. Fixed when there is no rIC to ask. */
  const idle: (cb: (spareMs: number) => void) => number =
    typeof requestIdleCallback === "function"
      ? (cb) => requestIdleCallback((d) => cb(d.timeRemaining())) as unknown as number
      : (cb) => setTimeout(() => cb(BACKFILL_SLICE_CAP_MS), 200) as unknown as number;

  const step = (spareMs: number) => {
    backfillHandle = null;
    // The run can end mid-backfill. Building then would allocate an atlas onto
    // a torn-down state that nothing will ever dispose.
    if (!state.active) return;
    // Too little room to be worth painting into — come back on a better frame.
    if (spareMs < BACKFILL_SLICE_MIN_MS) {
      backfillHandle = idle(step);
      return;
    }
    if (!current) {
      const key = queue.shift();
      if (!key) return;
      // `sheetFor` may have finished this one already while the queue waited.
      if (state.sheets[key]) {
        backfillHandle = idle(step);
        return;
      }
      current = { key, build: startMonsterSheet(paintsFor(key), key) };
      inFlight.set(key, current.build);
    }
    const { key, build } = current;
    if (build.step(Math.min(spareMs, BACKFILL_SLICE_CAP_MS))) {
      state.sheets[key] = build.sheet;
      inFlight.delete(key);
      current = null;
    }
    backfillHandle = idle(step);
  };
  backfillHandle = idle(step);
}

/** Cancel a backfill in flight. Called from teardown. */
export function stopSheetBackfill(): void {
  // Drop any half-painted atlas WITH the callback. Keeping it would leave the
  // next session's `sheetFor` able to finish a build whose texture belongs to
  // the renderer this teardown is disposing.
  for (const b of inFlight.values()) b.sheet.texture.dispose();
  inFlight.clear();
  current = null;
  if (backfillHandle == null) return;
  if (typeof cancelIdleCallback === "function") cancelIdleCallback(backfillHandle);
  else clearTimeout(backfillHandle);
  backfillHandle = null;
}
