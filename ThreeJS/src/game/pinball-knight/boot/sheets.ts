/**
 * Sprite atlases — the knight's per-weapon look and the monster roster.
 *
 * Extracted from core.ts. Two related jobs live together here: the knight's
 * sheet is a COMPOSITE key (weapon + worn gear), rebuilt whenever either
 * changes, while the monster atlases are built once per session and cached on
 * `state`. Both are "which pixels does this actor draw with", so splitting them
 * would just mean two files importing the same painters.
 */
import { guardianFor } from "../boss-kinds";
import { CARDS } from "../cards";
import { type WeaponId } from "../items";
import { ZOMBIE_VARIANTS, makeZombiePaints, withRecoil, type ActorPaints } from "../render/cel-painter";
import { lookFromGear, lookKey, type KnightLook } from "../render/knight-look";
import { renderKnightPortrait } from "../render/knight-portrait";
import { getKnightSheet, requestKnightSheet, loadImportedKnightArt, playerArtKey } from "../render/knight-sheets";
import { bakeTintedSheet, buildSpriteSheet, startSpriteSheet, type SheetBuild, type SheetBuildOptions, type SpriteSheet } from "../engine/render/sprite";
import { syncAbilitySlots } from "../skill-runtime";
import { activeWeapon, state, type EnemyKind } from "../state";
import { KIND_SKIN } from "../spawn/kind-skin";
import { KIND_IDS } from "../bestiary";
import { SHEET_PAINTERS } from "../render/sheet-painters";
import { authoredDirs, importedPaints, loadImportedSheet, sheetPalette, type ImportedSheet } from "../render/imported-paints";
import { authoredFacingsFor } from "./manifest-inventory";
import { sheetCoverage } from "../tools/sprite-forge/build-plan";
import { _clearPortraitCache } from "../render/monster-portrait";
import { _clearMonsterIconCache } from "../gui/icons";
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
export const importedPalettes = new Map<SheetKey, number[][]>();

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
  | "necromancer" | "crystalback" | "mimic" | "bloater" | "platypus" | "espresso" | "gnome" | "cigarette" | "toucan"
  | "reaper" | "broodmother" | "overlord" | "archivist" | "dragon" | "trex" | "jade_buddha" | "burger" | "fries" | "milkshake" | "crawling_hand" | "sumo_ninja" | "six_armed_god" | "zippo" | "cerberus" | "clam" | "crab" | "pinball_boss" | "medusa" | "dracula" | "spinning_top"
  | "shark_trapper" | "dolphin_brawler" | "octopus_gunner" | "clownfish_mob" | "lionfish_mob" | "anglerfish_mob" | "pufferfish_mob" | "swordfish_mob" | "moray_mob" | "seahorse_mob"
  | "dragon_snake_head" | "dragon_snake_body" | "dragon_snake_tail"
  | "christmas_tree"
  | "gas_can"
  | "hamster_ball"
  | "ascii_human"
  | "computer_screen"
  | "giant_ascii_human"
  | "doppelganger"
  | "pit_peeper"
  | "dumpster_dan"
  | "toaster_gremlin"
  | "lip_flapper"
  | "hydrant_hound"
  | "blaster_frank"
  | "junkbot"
  | "junkbot_tractor"
  | "junkbot_cyber"
  | "junkbot_motor"
  | "junkbot_crane"
  | "junkbot_appliance"
  | "corvid_bomber"
  | "vulture_scavenger"
  | "gull_bomber"
  | "sky_falcon"
  | "magma_slime"
  | "toxic_slime"
  | "frost_slime"
  | "void_slime";

/**
 * EnemyKind → the atlas that kind draws with, DERIVED, not re-listed.
 */
export const SHEET_KEYS = new Set<string>([
  "zombie", "spider", "brute", "warden", "spitter", "ghost", "bat", "slime", "boss",
  "goblin", "pin", "golem", "chomper", "magnet", "webspinner", "sporeling",
  "hound", "jester", "croaker", "rotortail", "stiltneck", "fish_feet",
  "necromancer", "crystalback", "mimic", "bloater", "platypus", "espresso", "gnome", "cigarette", "toucan", "reaper", "broodmother", "overlord", "archivist", "dragon", "trex", "jade_buddha", "burger", "fries", "milkshake", "crawling_hand", "sumo_ninja", "six_armed_god", "zippo", "cerberus", "clam", "crab", "pinball_boss", "medusa", "dracula", "spinning_top",
  "shark_trapper", "dolphin_brawler", "octopus_gunner", "clownfish_mob", "lionfish_mob", "anglerfish_mob", "pufferfish_mob", "swordfish_mob", "moray_mob", "seahorse_mob",
  "dragon_snake_head", "dragon_snake_body", "dragon_snake_tail",
  "christmas_tree",
  "gas_can",
  "hamster_ball",
  "ascii_human",
  "computer_screen",
  "giant_ascii_human",
  "doppelganger",
  "pit_peeper",
  "dumpster_dan",
  "toaster_gremlin",
  "lip_flapper",
  "hydrant_hound",
  "blaster_frank",
  "junkbot",
  "junkbot_tractor",
  "junkbot_cyber",
  "junkbot_motor",
  "junkbot_crane",
  "junkbot_appliance",
  "corvid_bomber",
  "vulture_scavenger",
  "gull_bomber",
  "sky_falcon",
  "magma_slime",
  "toxic_slime",
  "frost_slime",
  "void_slime",
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
const BACKFILL: SheetKey[] = ["ghost", "chomper", "jester", "croaker", "brute", "slime", "bat", "rotortail", "golem", "magnet", "spitter", "webspinner", "stiltneck", "fish_feet", "burger", "fries", "milkshake", "crawling_hand", "sumo_ninja", "zippo"];

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
export const imported = new Map<SheetKey, ActorPaints>();

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
    S: { ...painted.S, ...art.S, death: (art.S?.death && art.S.death.length > 0) ? art.S.death : painted.S.death },
    N: { ...painted.N, ...art.N, death: (art.N?.death && art.N.death.length > 0) ? art.N.death : painted.N.death },
    E: { ...painted.E, ...art.E, death: (art.E?.death && art.E.death.length > 0) ? art.E.death : painted.E.death },
    ...(painted.beats ? { beats: painted.beats } : {}),
    // Frank's 24 baked in-betweens keep the original eight-beat stride.
    // Apply only to the dense imported walk, preserving fallback/older sheets.
    ...(key === "blaster_frank" && art.S?.walk?.length === 24
      ? { beats: { ...painted.beats, walk: 8, run: 8 } } : {}),
  };
}

/** Idle handle, so a teardown mid-backfill doesn't paint into a dead session. */
let backfillHandle: number | null = null;
/** Atlases the backfill has started but not finished. See `sheetFor`. */
const inFlight = new Map<SheetKey, SheetBuild>();
let current: { key: SheetKey; build: SheetBuild } | null = null;

/**
 * Build the essential fallback atlases. Optional work starts on descent.
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
  // Optional monster atlases start on descent, never during the intro or lobby.
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
  bloater: "bloater",
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
  trex: "trex",
  boss: "overlord",
  platypus: "platypus",
  espresso: "espresso",
  gnome: "gnome",
  cigarette: "cigarette",
  toucan: "toucan",
  jade_buddha: "jade_buddha",
  dragon_snake_head: "dragon_snake_head",
  dragon_snake_body: "dragon_snake_body",
  dragon_snake_tail: "dragon_snake_tail",
  burger: "burger",
  fries: "fries",
  milkshake: "milkshake",
  crawling_hand: "crawling_hand",
  sumo_ninja: "sumo_ninja",
  six_armed_god: "six_armed_god",
  zippo: "zippo",
  cerberus: "cerberus",
  clam: "clam",
  crab: "crab",
  pinball_boss: "pinball_boss",
  medusa: "medusa",
  dracula: "dracula",
  spinning_top: "spinning_top",
  shark_trapper: "shark_trapper",
  dolphin_brawler: "dolphin_brawler",
  octopus_gunner: "octopus_gunner",
  clownfish_mob: "clownfish_mob",
  lionfish_mob: "lionfish_mob",
  anglerfish_mob: "anglerfish_mob",
  pufferfish_mob: "pufferfish_mob",
  swordfish_mob: "swordfish_mob",
  moray_mob: "moray_mob",
  seahorse_mob: "seahorse_mob",
  christmas_tree: "christmas_tree",
  gas_can: "gas_can",
  hamster_ball: "hamster_ball",
  ascii_human: "ascii_human",
  computer_screen: "computer_screen",
  giant_ascii_human: "giant_ascii_human",
  doppelganger: "doppelganger",
  pit_peeper: "pit_peeper",
  dumpster_dan: "dumpster_dan",
  toaster_gremlin: "toaster_gremlin",
  lip_flapper: "lip_flapper",
  blaster_frank: "blaster_frank",
  junkbot: "junkbot",
  junkbot_tractor: "junkbot_tractor",
  junkbot_cyber: "junkbot_cyber",
  junkbot_motor: "junkbot_motor",
  junkbot_crane: "junkbot_crane",
  junkbot_appliance: "junkbot_appliance",
};


/**
 * `stiltneck` is deliberately ABSENT, and its sheet still ships.
 *
 * The sidecar now splits its first band into idle+walk, so the import WORKS —
 * and `ab.test.ts` measured what it looks like: isolated 48.4% against the
 * painter's 29.5%, the worst margin of the five pairs, and `work/ab-stiltneck.png`
 * shows why. The figure comes through thin and speckled where the painter is
 * bold. The painter was authored from this sheet as a shape spec and is simply
 * a better sprite.
 *
 * The file stays in `public/sprites/` so a future pass can revisit its tuning,
 * but until someone makes its authored pixels look better than the code-generated
 * ones, this test keeps it out of the active set so it cannot regress the visuals.
 */
export const INTENTIONALLY_ABSENT_IMPORTED_SHEETS: readonly string[] = [
  "stiltneck",
];

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
 * Player art loads at boot. Normal gameplay loads monster art through the
 * descent screen, after it has been presented, and awaits the required sheets
 * before spawning the floor. This all-roster entry remains for explicit art QA.
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

/**
 * Load imported art for a specific monster sheet on-demand.
 * Idempotent: returns true immediately if already loaded.
 */
export async function loadMonsterSheet(key: SheetKey, active: () => boolean = () => true): Promise<boolean> {
  if (!importedArtEnabled()) return false;
  if (imported.has(key)) return true;
  const name = IMPORTED_ART[key];
  if (!name) return false;
  const facings = authoredFacingsFor(name);
  const loaded = (await Promise.all(facings.map((d) => loadImportedSheet(name, d)))).filter(
    (s): s is ImportedSheet => s !== null,
  );
  if (!active() || !loaded.length) return false;
  const paints = importedPaints(loaded);
  if (!paints) return false;
  imported.set(key, paints);
  const pal = sheetPalette(loaded);
  if (pal) importedPalettes.set(key, pal);
  _clearPortraitCache();
  _clearMonsterIconCache();
  const cov = sheetCoverage(loaded.map((s) => s.manifest));
  console.info(
    `[dungeon] ${key}: imported art from ${loaded.length} sheet(s) ` +
      `[${authoredDirs(loaded).join("/")}]${loaded.length < 3 ? " — other facings reuse it" : ""}\n` +
      `           coverage: ${cov.summary}` +
      (cov.clips.missing.length ? ` (${cov.clips.missing.join("/")} fall through to the painter)` : ""),
  );
  rebuild(key);
  return true;
}

/**
 * Determine which monster sheets are required for a given floor level.
 */
export function keysForFloor(level: number): SheetKey[] {
  const keys: SheetKey[] = ["zombie", guardianFor(level).art.sheetKey];
  if (level >= 1) keys.push("goblin", "spider", "sporeling", "hound", "pin");
  if (level >= 2) keys.push("chomper", "croaker", "fish_feet", "jester", "ghost", "platypus", "espresso", "gnome", "cigarette", "toucan", "crawling_hand", "zippo", "clam", "crab", "gas_can", "hamster_ball", "pit_peeper", "dumpster_dan", "corvid_bomber", "gull_bomber", "toxic_slime");
  if (level >= 3) keys.push("bat", "slime", "brute", "golem", "magnet", "rotortail", "mimic", "burger", "fries", "milkshake", "dolphin_brawler", "clownfish_mob", "moray_mob", "seahorse_mob", "christmas_tree", "toaster_gremlin", "lip_flapper", "hydrant_hound", "blaster_frank", "junkbot", "junkbot_tractor", "junkbot_cyber", "junkbot_motor", "junkbot_crane", "junkbot_appliance", "vulture_scavenger", "sky_falcon", "magma_slime", "frost_slime");
  if (level >= 4) keys.push("webspinner", "stiltneck", "spitter", "necromancer", "warden", "crystalback", "sumo_ninja", "shark_trapper", "lionfish_mob", "pufferfish_mob", "swordfish_mob", "ascii_human", "computer_screen", "giant_ascii_human", "void_slime");
  if (level >= 5) keys.push("reaper", "archivist", "broodmother", "dragon", "trex", "jade_buddha", "six_armed_god", "cerberus", "pinball_boss", "medusa", "dracula", "spinning_top", "octopus_gunner", "anglerfish_mob", "dragon_snake_head", "dragon_snake_body", "dragon_snake_tail", "doppelganger");
  return [...new Set(keys)];
}

/**
 * Load imported monster art specifically needed for a given floor level.
 */
export async function loadMonsterSheetsForFloor(
  level: number,
  progress: (done: number, total: number) => void | Promise<void> = () => {},
  active: () => boolean = () => true,
): Promise<void> {
  if (!importedArtEnabled()) return;
  const needed = keysForFloor(level);
  for (let i = 0; i < needed.length; i++) {
    if (!active()) return;
    await loadMonsterSheet(needed[i], active);
    if (!active()) return;
    await progress(i + 1, needed.length);
  }
}

/** The background backfill — loads remaining monster art during idle/delay. */
export async function applyImportedMonsterArt(): Promise<void> {
  if (!importedArtEnabled() || applyingMonsters || appliedMonsters) return;
  applyingMonsters = true;
  try {
    for (const key of Object.keys(IMPORTED_ART) as SheetKey[]) {
      if (imported.has(key)) continue;
      await loadMonsterSheet(key);
      // Yield to frame loop between monster rebuilds
      await new Promise((r) => setTimeout(r, 16));
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
export function rebuild(key: SheetKey): void {
  _clearPortraitCache();
  _clearMonsterIconCache();
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
    if (KIND_SKIN[z.kind]?.tint !== undefined) {
      state.expansionSheets[z.kind]?.texture.dispose();
      delete state.expansionSheets[z.kind];
      const rebaked = skinSheet(z.kind);
      if (rebaked) {
        if (typeof (z.anim as any).reapplySheet === "function") {
          (z.anim as any).reapplySheet(rebaked);
        } else {
          z.sprite.setSheet(rebaked);
          z.anim?.reapply?.();
        }
      }
    } else {
      if (typeof (z.anim as any).reapplySheet === "function") {
        (z.anim as any).reapplySheet(sheet);
      } else {
        z.sprite.setSheet(sheet);
        z.anim?.reapply?.();
      }
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
export function startSheetBackfill(): void {
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

/**
 * BUILD EVERY ATLAS THE FLOOR CAN SPAWN, BEHIND THE DESCENT SCREEN.
 *
 * ── WHY THE IN-PLAY BACKFILL HAD TO GO ──────────────────────────────────────
 *
 * `startSheetBackfill` painted the deeper roster one idle slice at a time
 * WHILE THE PLAYER WAS PLAYING. Measured on 2026-09-10 (host Chrome, RTX 3090
 * Ti, `scripts/lag` probes — see docs/perf/maze-lag-audit.md): a single
 * `paintFrame` costs 0.3 ms of readback when the page is quiet and 4–95 ms
 * when the dungeon is rendering, so every idle slice that painted even ONE
 * frame produced a 33–100 ms hitch, and a 30 s run carried 50–140 of them.
 * The slice budget cannot help — it is checked AFTER the frame that already
 * blew it — and no budget makes a 95 ms readback fit in a 16 ms frame.
 *
 * So the atlases are painted HERE, under the progress bar, where a slow
 * readback costs the player nothing but a slightly longer descent. The set is
 * `keysForFloor(level)`: everything the spawn tables can put on this floor.
 * Anything outside it (a boss adopted mid-run) still builds synchronously on
 * first `sheetFor`, exactly as before.
 *
 * `progress` is awaited between slices so the descent screen can present a
 * frame; `HOLD_SLICE_MS` bounds each slice so the bar keeps moving.
 */
const HOLD_SLICE_MS = 12;

export async function buildFloorSheets(
  level: number,
  progress: (done: number, total: number) => void | Promise<void> = () => {},
  active: () => boolean = () => true,
): Promise<SheetKey[]> {
  const needed = keysForFloor(level).filter((key) => !state.sheets[key]);
  const built: SheetKey[] = [];
  for (let i = 0; i < needed.length; i++) {
    if (!active()) break;
    const key = needed[i];
    if (state.sheets[key]) continue;
    // A build the old backfill left half-painted is finished rather than restarted.
    const build = inFlight.get(key) ?? startMonsterSheet(paintsFor(key), key);
    inFlight.set(key, build);
    while (!build.step(HOLD_SLICE_MS)) {
      await progress(i, needed.length);
      if (!active()) {
        build.sheet.texture.dispose();
        inFlight.delete(key);
        return built;
      }
    }
    state.sheets[key] = build.sheet;
    inFlight.delete(key);
    if (current?.key === key) current = null;
    built.push(key);
    await progress(i + 1, needed.length);
  }

  // Pre-bake tinted expansion skins for candidate kinds so bakeTintedSheet never blocks a gameplay frame
  const tintedCandidates: EnemyKind[] = [];
  if (level >= 2) tintedCandidates.push("wisp");
  if (level >= 4) tintedCandidates.push("sapper");
  if (level >= 5) tintedCandidates.push("dracula_bat");
  for (const kind of tintedCandidates) {
    if (!active()) break;
    skinSheet(kind);
  }

  return built;
}

/**
 * The knight's atlases for every weapon he could be holding on this floor —
 * both slots and every weapon lying on the ground — painted while the
 * descent screen is still up.
 *
 * `applyWeaponArt` paints a re-dress at 2 ms per frame inside the rAF loop,
 * and each of those frames carries the same 4–95 ms readback as the monster
 * backfill did (the 150–270 ms frames in the audit were exactly this, on a
 * weapon pickup). Warming here turns a pickup into a cache hit. Runs after
 * the floor is built, so the ground items are known. Returns the ids warmed.
 */
export function knightWarmIds(): WeaponId[] {
  const ids = new Set<WeaponId>();
  for (const w of state.weaponSlots) if (w) ids.add(w.id);
  for (const g of state.groundItems) if (g.kind === "weapon") ids.add(g.id as WeaponId);
  return [...ids];
}

/**
 * The (weapon, look) pairs a pickup on this floor can put on the knight:
 * every warm weapon at the current look, and the slot weapons at each look
 * one piece of ground gear away (a helmet on the floor means "current look
 * with a helmet" is one pickup from being live). Gear BREAKING is not
 * anticipated — it is rare, and the crushed-cell cache in paintFrame makes
 * that re-dress cheap anyway.
 */
export function knightWarmTargets(): Array<{ id: WeaponId; look: KnightLook }> {
  const base = lookFromGear(state.gear);
  const seen = new Set<string>();
  const out: Array<{ id: WeaponId; look: KnightLook }> = [];
  const add = (id: WeaponId, look: KnightLook) => {
    const k = lookKey(id, look);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ id, look });
  };
  for (const id of knightWarmIds()) add(id, base);
  const slots = state.weaponSlots.filter((w): w is NonNullable<typeof w> => !!w).map((w) => w.id);
  for (const g of state.groundItems) {
    if (g.kind !== "gear") continue;
    const slot = g.id;
    if (slot !== "helmet" && slot !== "armor" && slot !== "boots") continue;
    if (base[slot]) continue;
    for (const id of slots) add(id, { ...base, [slot]: true });
  }
  return out;
}

export async function warmKnightSheets(
  yieldFrame: () => Promise<void>,
  active: () => boolean = () => true,
  budgetMs = HOLD_SLICE_MS,
): Promise<string[]> {
  const warmed: string[] = [];
  for (const { id, look } of knightWarmTargets()) {
    while (active() && !requestKnightSheet(id, look, "dungeon", budgetMs)) await yieldFrame();
    if (!active()) break;
    warmed.push(lookKey(id, look));
  }
  // Leave the consumer pinned to what is actually in hand, as applyWeaponArt would.
  if (active()) requestKnightSheet(activeWeapon().id, lookFromGear(state.gear), "dungeon", 0);
  return warmed;
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
