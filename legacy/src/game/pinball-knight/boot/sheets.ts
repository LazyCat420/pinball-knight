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
import { makeHoundPaints } from "../render/monsters/hound";
import { lookFromGear, lookKey } from "../render/knight-look";
import { renderKnightPortrait } from "../render/knight-portrait";
import { getKnightSheet } from "../render/knight-sheets";
import { buildSpriteSheet, type SpriteSheet } from "../engine/render/sprite";
import { syncAbilitySlots } from "../skill-runtime";
import { activeWeapon, state } from "../state";

export function playerSheetFor(id: WeaponId): SpriteSheet {
  return getKnightSheet(id, lookFromGear(state.gear), "dungeon");
}

/** Make the sprite match the active hand AND the worn gear. Runs every frame;
 * cheap no-op when the composite key hasn't changed. Because gear is part of
 * the key, a helmet pickup, an armory purchase, or a cuirass shattering
 * mid-fight all re-dress the knight with no extra hooks. */
export function applyWeaponArt(): void {
  const id = activeWeapon().id;
  const key = lookKey(id, lookFromGear(state.gear));
  if (key === state.playerArtKey || !state.player) return;
  state.player.sprite.setSheet(playerSheetFor(id));
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
function monsterSheet(paints: ActorPaints): SpriteSheet {
  return buildSpriteSheet(withRecoil(paints));
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
  | "spider" | "brute" | "spitter" | "ghost" | "bat" | "slime" | "boss"
  | "goblin" | "pin" | "golem" | "chomper" | "magnet" | "webspinner" | "sporeling"
  | "hound" | "jester" | "croaker" | "rotortail";

/**
 * EnemyKind → the atlas that kind draws with, for callers that hold a kind
 * string rather than a sheet key (the co-op ghost spawner).
 *
 * Only the kinds with their OWN atlas are listed. The tinted expansion skins
 * (hound, wisp, mimic …) borrow one and are resolved through `EXPANSION_SKIN`
 * in spawn/factory.ts instead; anything absent falls back to the zombie sheet.
 */
export const SHEET_KEY_BY_KIND: Record<string, SheetKey> = {
  spider: "spider", brute: "brute", spitter: "spitter", ghost: "ghost",
  bat: "bat", slime: "slime", goblin: "goblin", pin: "pin", golem: "golem",
  chomper: "chomper", magnet: "magnet", webspinner: "webspinner",
  sporeling: "sporeling", hound: "hound", jester: "jester", croaker: "croaker", rotortail: "rotortail",
};

/** key → (paint the atlas, read it off state, write it back). */
const BUILDERS: Record<SheetKey, { make: () => ActorPaints; get: () => SpriteSheet | null; set: (s: SpriteSheet) => void }> = {
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
const BACKFILL: SheetKey[] = ["ghost", "chomper", "jester", "croaker", "brute", "slime", "bat", "rotortail", "golem", "magnet", "spitter", "webspinner"];

/**
 * Get an atlas, building it if the backfill hasn't reached it yet.
 *
 * Every spawn path goes through this, so no monster can appear without its art
 * regardless of how far the idle queue got.
 */
export function sheetFor(key: SheetKey): SpriteSheet {
  const b = BUILDERS[key];
  const hit = b.get();
  if (hit) return hit;
  const built = monsterSheet(b.make());
  b.set(built);
  return built;
}

/** Idle handle, so a teardown mid-backfill doesn't paint into a dead session. */
let backfillHandle: number | null = null;

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
}

/**
 * Warm the remaining atlases one per idle callback.
 *
 * One per callback, never a batch: each is ~275 ms of paint on the slow column
 * of the measurement, and `requestIdleCallback`'s deadline is advisory — a
 * batch would blow through it and land as exactly the long task this avoids.
 */
function startBackfill(): void {
  stopSheetBackfill();
  const queue = [...BACKFILL];
  const idle: (cb: () => void) => number =
    typeof requestIdleCallback === "function"
      ? (cb) => requestIdleCallback(() => cb()) as unknown as number
      : (cb) => setTimeout(cb, 200) as unknown as number;

  const step = () => {
    backfillHandle = null;
    // The run can end mid-backfill. Building then would allocate an atlas onto
    // a torn-down state that nothing will ever dispose.
    if (!state.active) return;
    const key = queue.shift();
    if (!key) return;
    sheetFor(key);
    backfillHandle = idle(step);
  };
  backfillHandle = idle(step);
}

/** Cancel a backfill in flight. Called from teardown. */
export function stopSheetBackfill(): void {
  if (backfillHandle == null) return;
  if (typeof cancelIdleCallback === "function") cancelIdleCallback(backfillHandle);
  else clearTimeout(backfillHandle);
  backfillHandle = null;
}
