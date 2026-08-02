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
import { ZOMBIE_VARIANTS, makeBatPaints, makeBossPaints, makeBrutePaints, makeChomperPaints, makeGhostPaints, makeGoblinPaints, makeGolemPaints, makeMagnetPaints, makePinPaints, makeSlimePaints, makeSpiderPaints, makeSpitterPaints, makeWebspinnerPaints, makeZombiePaints, withRecoil, type ActorPaints } from "../render/cel-painter";
import { makeSporelingPaints } from "../render/monsters/sporeling";
import { makeJesterPaints } from "../render/monsters/jester";
import { makeCroakerPaints } from "../render/monsters/croaker";
import { makeRotortailPaints } from "../render/monsters/rotortail";
import { makeStiltneckPaints } from "../render/monsters/stiltneck";
import { makeFishFeetPaints } from "../render/monsters/fish_feet";
import { makeHoundPaints } from "../render/monsters/hound";
import { lookFromGear, lookKey } from "../render/knight-look";
import { renderKnightPortrait } from "../render/knight-portrait";
import { getKnightSheet, requestKnightSheet } from "../render/knight-sheets";
import { buildSpriteSheet, startSpriteSheet, type SheetBuild, type SpriteSheet } from "../engine/render/sprite";
import { syncAbilitySlots } from "../skill-runtime";
import { activeWeapon, state } from "../state";
import { authoredDirs, importedPaints, loadImportedSheet, type ImportedSheet } from "../render/imported-paints";
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
  const key = lookKey(id, look);
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

function monsterSheet(paints: ActorPaints): SpriteSheet {
  return buildSpriteSheet(withRecoil(paints), LOCK);
}

/** The same rule, for the incremental path. Both go through `withRecoil`. */
function startMonsterSheet(paints: ActorPaints): SheetBuild {
  return startSpriteSheet(withRecoil(paints), LOCK);
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
 * RESKIN, `() => state.spiderSheet`), so the call sites did not have to change
 * — they just have to go through `sheetFor` now instead of reading the field.
 *
 * The cache IS the existing `state.*Sheet` fields, deliberately. `state.ts`
 * reset and `dispose.ts` teardown already null every one of them; a second,
 * separate memo would be a fresh way to leak 22 atlases across a floor change.
 */
export type SheetKey =
  | "zombie" | "spider" | "brute" | "spitter" | "ghost" | "bat" | "slime" | "boss"
  | "goblin" | "pin" | "golem" | "chomper" | "magnet" | "webspinner" | "sporeling"
  | "hound" | "jester" | "croaker" | "rotortail" | "stiltneck" | "fish_feet";

/**
 * EnemyKind → the atlas that kind draws with, for callers that hold a kind
 * string rather than a sheet key (the co-op ghost spawner).
 *
 * Only the kinds with their OWN atlas are listed. The tinted expansion skins
 * (hound, wisp, mimic …) borrow one and are resolved through `EXPANSION_SKIN`
 * in spawn/factory.ts instead; anything absent falls back to the zombie sheet.
 */
export const SHEET_KEY_BY_KIND: Record<string, SheetKey> = {
  zombie: "zombie", spider: "spider", brute: "brute", spitter: "spitter", ghost: "ghost",
  bat: "bat", slime: "slime", goblin: "goblin", pin: "pin", golem: "golem",
  chomper: "chomper", magnet: "magnet", webspinner: "webspinner",
  sporeling: "sporeling", hound: "hound", jester: "jester", croaker: "croaker", rotortail: "rotortail",
  stiltneck: "stiltneck", fish_feet: "fish_feet",
};

/** key → (paint the atlas, read it off state, write it back). */
const BUILDERS: Record<SheetKey, { make: () => ActorPaints; get: () => SpriteSheet | null; set: (s: SpriteSheet) => void }> = {
  zombie: { make: () => makeZombiePaints(ZOMBIE_VARIANTS[0]), get: () => state.zombieSheet, set: (s) => { state.zombieSheet = s; } },
  spider: { make: makeSpiderPaints, get: () => state.spiderSheet, set: (s) => { state.spiderSheet = s; } },
  brute: { make: makeBrutePaints, get: () => state.bruteSheet, set: (s) => { state.bruteSheet = s; } },
  spitter: { make: makeSpitterPaints, get: () => state.spitterSheet, set: (s) => { state.spitterSheet = s; } },
  ghost: { make: makeGhostPaints, get: () => state.ghostSheet, set: (s) => { state.ghostSheet = s; } },
  bat: { make: makeBatPaints, get: () => state.batSheet, set: (s) => { state.batSheet = s; } },
  slime: { make: makeSlimePaints, get: () => state.slimeSheet, set: (s) => { state.slimeSheet = s; } },
  boss: { make: makeBossPaints, get: () => state.bossSheet, set: (s) => { state.bossSheet = s; } },
  goblin: { make: makeGoblinPaints, get: () => state.goblinSheet, set: (s) => { state.goblinSheet = s; } },
  pin: { make: makePinPaints, get: () => state.pinSheet, set: (s) => { state.pinSheet = s; } },
  golem: { make: makeGolemPaints, get: () => state.golemSheet, set: (s) => { state.golemSheet = s; } },
  chomper: { make: makeChomperPaints, get: () => state.chomperSheet, set: (s) => { state.chomperSheet = s; } },
  magnet: { make: makeMagnetPaints, get: () => state.magnetSheet, set: (s) => { state.magnetSheet = s; } },
  webspinner: { make: makeWebspinnerPaints, get: () => state.webspinnerSheet, set: (s) => { state.webspinnerSheet = s; } },
  sporeling: { make: makeSporelingPaints, get: () => state.sporelingSheet, set: (s) => { state.sporelingSheet = s; } },
  hound: { make: makeHoundPaints, get: () => state.houndSheet, set: (s) => { state.houndSheet = s; } },
  jester: { make: makeJesterPaints, get: () => state.jesterSheet, set: (s) => { state.jesterSheet = s; } },
  croaker: { make: makeCroakerPaints, get: () => state.croakerSheet, set: (s) => { state.croakerSheet = s; } },
  rotortail: { make: makeRotortailPaints, get: () => state.rotortailSheet, set: (s) => { state.rotortailSheet = s; } },
  stiltneck: { make: makeStiltneckPaints, get: () => state.stiltneckSheet, set: (s) => { state.stiltneckSheet = s; } },
  fish_feet: { make: makeFishFeetPaints, get: () => state.fishFeetSheet, set: (s) => { state.fishFeetSheet = s; } },
};

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
const BACKFILL: SheetKey[] = ["ghost", "chomper", "jester", "croaker", "brute", "slime", "bat", "rotortail", "golem", "magnet", "spitter", "webspinner", "stiltneck"];

/**
 * Get an atlas, building it if the backfill hasn't reached it yet.
 *
 * Every spawn path goes through this, so no monster can appear without its art
 * regardless of how far the idle queue got — including an atlas the backfill is
 * halfway through, which is finished on the spot rather than handed over with
 * transparent cells in it.
 */
export function sheetFor(key: SheetKey): SpriteSheet {
  const b = BUILDERS[key];
  const hit = b.get();
  if (hit) return hit;
  const partial = inFlight.get(key);
  if (partial) {
    inFlight.delete(key);
    if (current?.key === key) current = null;
    const s = partial.finish();
    b.set(s);
    return s;
  }
  const built = monsterSheet(paintsFor(key));
  b.set(built);
  return built;
}

/**
 * IMPORTED ART OVERRIDES, once loaded. Empty until `applyImportedArt` resolves.
 *
 * Consulted through `paintsFor` rather than replacing `BUILDERS[key].make`,
 * because the painter has to stay reachable: it is the fallback when a sheet is
 * missing, when its dimensions no longer match its manifest, and when the
 * player turns imported art off.
 */
const imported = new Map<SheetKey, ActorPaints>();

/** The art a key builds with: imported if it arrived, painted otherwise. */
export function paintsFor(key: SheetKey): ActorPaints {
  return imported.get(key) ?? BUILDERS[key].make();
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
  state.zombieSheet = state.zombieVariantSheets[0]; // legacy single-sheet handle
  for (const key of ESSENTIAL) sheetFor(key);
  startBackfill();
  void applyImportedArt();
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
const IMPORTED_ART: Partial<Record<SheetKey, string>> = {
  jester: "jester",
  rotortail: "beaver",
  croaker: "frog",
  stiltneck: "stiltneck",
  fish_feet: "fish_feet",
  zombie: "zombie",
};

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
 */
export async function applyImportedArt(): Promise<void> {
  if (!importedArtEnabled()) return;
  for (const [key, name] of Object.entries(IMPORTED_ART) as [SheetKey, string][]) {
    const loaded = (await Promise.all(DIRS.map((d) => loadImportedSheet(name, d)))).filter(
      (s): s is ImportedSheet => s !== null,
    );
    if (!loaded.length) continue;
    const paints = importedPaints(loaded);
    if (!paints) continue;
    imported.set(key, paints);
    _clearPortraitCache();
    console.info(
      `[dungeon] ${key}: imported art from ${loaded.length} sheet(s) ` +
        `[${authoredDirs(loaded).join("/")}]${loaded.length < 3 ? " — other facings reuse it" : ""}`,
    );
    rebuild(key);
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
  const b = BUILDERS[key];
  if (!b.get() && !inFlight.has(key)) return; // never built; sheetFor will do it
  inFlight.delete(key);
  if (current?.key === key) current = null;
  const sheet = monsterSheet(paintsFor(key));
  b.set(sheet);
  if (key === "zombie") {
    state.zombieVariantSheets = [sheet];
  }
  for (const z of state.zombies) {
    if (SHEET_KEY_BY_KIND[z.kind] === key) z.sprite.setSheet(sheet);
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
      if (BUILDERS[key].get()) {
        backfillHandle = idle(step);
        return;
      }
      current = { key, build: startMonsterSheet(paintsFor(key)) };
      inFlight.set(key, current.build);
    }
    const { key, build } = current;
    if (build.step(Math.min(spareMs, BACKFILL_SLICE_CAP_MS))) {
      BUILDERS[key].set(build.sheet);
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
