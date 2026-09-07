/**
 * MONSTER PORTRAITS — the actual creature, painted into a card's art window.
 *
 * A card is a slain monster's power bottled (see cards.ts). Until this file
 * existed the card said so in TEXT and then showed a 150px emoji: 🧟 rendered
 * as a washed-out grey blob behind a speckle field, which is exactly as
 * anonymous as the stat chips the monster rework replaced. The card claimed an
 * identity its art refused to draw.
 *
 * The fix costs almost nothing, because the game ALREADY owns cel-shaded art
 * for every monster in it. `cel-painter.ts` builds each enemy's sprite sheet
 * from plain canvas-2D painters over a 128×128 box — no three.js, no WebGL, no
 * DOM. So a card portrait is just: run the same painter the horde uses, into an
 * offscreen 128×128, and blit it scaled into the art window.
 *
 * THE RULE THIS FILE KEEPS: a portrait must be the SAME art the player fights.
 * `KIND_PORTRAIT` therefore mirrors core.ts's spawn skinning exactly —
 * `EXPANSION_SKIN` (borrowed sheet + tint) and `RESKIN` (bespoke sheet) — so a
 * Wisp card shows the cyan-tinted ghost that a Wisp actually is. If someone
 * gives an expansion kind its own atlas later, this table is the one other
 * place that has to learn about it, and the exhaustive `Record<EnemyKind, …>`
 * makes forgetting a compile error rather than a blank card.
 *
 * Painters are cached: the same handful of card faces repaint constantly (every
 * tavern open, every menu tab), and re-running a painter chain per repaint was
 * measurably wasteful for art that never changes.
 */
import {
  makeZombiePaints,
  makeSpiderPaints,
  makeBrutePaints,
  makeSpitterPaints,
  makeGhostPaints,
  makeBatPaints,
  makeSlimePaints,
  makeGoblinPaints,
  makePinPaints,
  makeGolemPaints,
  makeChomperPaints,
  makeMagnetPaints,
  makeWebspinnerPaints,
  makeReaperPaints,
  makeBossPaints,
  ZOMBIE_VARIANTS,
  type ActorPaints,
  type FramePaint,
} from "./cel-painter";
import { ART_PX } from "../constants";
import { SHEET_KEY_BY_KIND, paintsFor } from "../boot/sheets";
import { installPalette } from "./palette";
import { ZOMBIE_TYPES, variantIndicesFor, type ZombieType } from "../zombie-types";
import type { EnemyKind } from "../state";
import { KIND_SKIN } from "../spawn/kind-skin";
import { makeSporelingPaints } from "./monsters/sporeling";
import { makeJesterPaints } from "./monsters/jester";
import { makeCroakerPaints } from "./monsters/croaker";
import { makeRotortailPaints } from "./monsters/rotortail";
import { makeStiltneckPaints } from "./monsters/stiltneck";
import { makeHoundPaints } from "./monsters/hound";
import { makeFishFeetPaints } from "./monsters/fish_feet";
import { makeBloaterPaints } from "./monsters/bloater";
import { makeWardenPaints } from "./monsters/warden";
import { makeNecroPaints } from "./monsters/necro";
import { makePlatypusPaints } from "./monsters/platypus";
import { makeEspressoPaints } from "./monsters/espresso";
import { makeGnomePaints } from "./monsters/gnome";
import { makeCigarettePaints } from "./monsters/cigarette";

/** The box every cel painter draws into (128) — portraits blit out of this. */
const PX = ART_PX;

/**
 * WHICH PAINTER EACH KIND WEARS — and nothing else.
 *
 * The tint and display scale used to live here too, hand-copied from the
 * spawner's skin tables with a comment asking the next reader to keep them in
 * step. They did not stay in step. `rotortail` read 1.0 here against the
 * world's 0.95, and `stiltneck` read 1.1 against the world's 1.0 — the second
 * of those putting a non-integer sprite scale back into the portrait four
 * weeks after `spawn/kind-skin.ts` retired it from the world for causing moiré
 * on the coat. `registry-drift.mjs` check C compared the OTHER pairing
 * (EXPANSION_SKIN ↔ KIND_PORTRAIT) and so could not see it.
 *
 * Both columns are now READ from `spawn/kind-skin.ts` (see `portraitSkin`
 * below), so the card cannot disagree with the thing you meet. What is left
 * here is the one fact this module actually owns: the painter.
 *
 * EXHAUSTIVE by EnemyKind on purpose — same discipline as ENEMY_DROPS and
 * KIND_INFO. Adding a monster should fail to compile here.
 */
const KIND_PORTRAIT: Record<EnemyKind, { paints: () => ActorPaints }> = {
  zombie: { paints: () => makeZombiePaints(ZOMBIE_VARIANTS[0]) },
  spider: { paints: makeSpiderPaints },
  brute: { paints: makeBrutePaints },
  spitter: { paints: makeSpitterPaints },
  ghost: { paints: makeGhostPaints },
  bat: { paints: makeBatPaints },
  slime: { paints: makeSlimePaints },
  sporeling: { paints: makeSporelingPaints },
  jester: { paints: makeJesterPaints },
  croaker: { paints: makeCroakerPaints },
  rotortail: { paints: makeRotortailPaints },
  stiltneck: { paints: makeStiltneckPaints },
  fish_feet: { paints: makeFishFeetPaints },
  hound: { paints: makeHoundPaints },
  reaper: { paints: makeReaperPaints },
  goblin: { paints: makeGoblinPaints },
  pin: { paints: makePinPaints },
  golem: { paints: makeGolemPaints },
  chomper: { paints: makeChomperPaints },
  magnet: { paints: makeMagnetPaints },
  webspinner: { paints: makeWebspinnerPaints },
  bloater: { paints: makeBloaterPaints },
  necromancer: { paints: makeNecroPaints },
  warden: { paints: makeWardenPaints },
  wisp: { paints: makeGhostPaints },
  sapper: { paints: makeMagnetPaints },
  crystalback: { paints: makeGolemPaints },
  mimic: { paints: makeGolemPaints },
  platypus: { paints: makePlatypusPaints },
  espresso: { paints: makeEspressoPaints },
  gnome: { paints: makeGnomePaints },
  cigarette: { paints: makeCigarettePaints },
  jade_buddha: { paints: makeBossPaints },
};

/**
 * PORTRAIT-ONLY FRAMING, for the kinds the WORLD does not scale.
 *
 * A kind with a `KIND_SKIN` row is scaled on spawn, and its portrait takes
 * that number — those two must agree or the card lies. A kind WITHOUT one
 * spawns at 1.0, so any number here is a composition choice about filling the
 * card's box, not a claim about the creature's size, and there is nothing for
 * it to drift against.
 *
 * ⚠️ `reaper` is the honest exception and is left alone deliberately: the
 * world scales it by `REAPER_SCALE` (1.4, constants/enemies.ts) inside
 * `spawn/reaper.ts` rather than through a skin row, so its 1.05 here IS a
 * disagreement — just a long-standing, purely cosmetic one, and re-framing the
 * Death Dealer's card is an art decision rather than a refactor. Noted in
 * OPEN_WORK.md rather than silently changed.
 */
const PORTRAIT_FRAMING: Partial<Record<EnemyKind, number>> = {
  brute: 1.05,
  reaper: 1.05,
};

/** The tint and scale a portrait paints with, read from the spawner's table. */
function portraitSkin(kind: EnemyKind): { tint: number | null; scale: number } {
  const skin = KIND_SKIN[kind];
  return {
    tint: skin?.tint ?? null,
    scale: skin?.scale ?? PORTRAIT_FRAMING[kind] ?? 1.0,
  };
}

/**
 * WHICH PAINTER EACH KIND WEARS — the paints half of `KIND_PORTRAIT`, exported
 * so a check can ask "what art does this EnemyKind actually have?".
 *
 * Derived rather than re-listed on purpose. This table is `Record<EnemyKind, …>`
 * and therefore compile-enforced to cover the roster; a second hand-written
 * kind→painter map would be the two-writers drift that the tint/scale comment
 * above already warns about, and it is exactly how `telegraph-clips.test.ts`
 * came to assert "the hound is a leaper on the SPIDER sheet" for months after
 * the hound got its own painter.
 */
export const KIND_PAINTS: Record<EnemyKind, () => ActorPaints> = Object.fromEntries(
  Object.entries(KIND_PORTRAIT).map(([kind, spec]) => [kind, spec.paints]),
) as Record<EnemyKind, () => ActorPaints>;

/** Painted-cel cache, keyed by kind (+ sub-type). Portraits never change. */
const _cache = new Map<string, HTMLCanvasElement | null>();

/**
 * A zombie SUB-TYPE wears the silhouette its stat story promises — the crawler
 * is legless, the flailer armless, the hobbler down one leg. `variantIndicesFor`
 * is the same selector the spawner uses, so the card portrait and the thing you
 * killed wear the same body.
 */
function zombieVariantFor(sub: ZombieType): number {
  const idx = variantIndicesFor(sub, ZOMBIE_VARIANTS);
  if (idx.length === 0) return 0;
  // The filtered sub-types (crawler/flailer/hobbler) get exactly the silhouette
  // their stat story promises, so take the first match and stop.
  //
  // The UNFILTERED ones (shambler/runner/lurcher/hulk/midget) may wear any
  // variant, and `idx[0]` handed all five the SAME body — five cards that
  // differed only in how big the identical zombie was drawn. Spreading them
  // deterministically across the eligible pool gives each its own rot tone,
  // rags and gore, which is what makes a Hulk card and a Midget card read as
  // two different monsters rather than one monster at two zoom levels.
  const spread = ZOMBIE_TYPE_ORDER.indexOf(sub);
  return idx[(spread < 0 ? 0 : spread) % idx.length];
}

/** Fixed order for the variant spread above — stable art, not incidental. */
const ZOMBIE_TYPE_ORDER: ZombieType[] = ["shambler", "runner", "lurcher", "hulk", "midget", "crawler", "flailer", "hobbler"];

/**
 * Make a document-independent 128×128 canvas.
 *
 * Guarded rather than assumed: this module is imported by holo-card.ts, which
 * unit tests import in a DOM-free environment. A portrait that can't be painted
 * returns null and the caller falls back to the emoji, so a headless import can
 * never throw.
 */
function scratch(): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const cv = document.createElement("canvas");
  cv.width = PX;
  cv.height = PX;
  return cv;
}

/**
 * Paint one monster cel and return it, or null when the art or the DOM is
 * unavailable. Cached, including the null so a miss isn't retried per repaint.
 *
 * The frame chosen is the FIRST IDLE frame facing SOUTH — the enemy looking
 * straight at you, which is the only facing that reads as a portrait. Walk and
 * death frames are mid-motion and read as an accident on a static card.
 */
export function monsterPortrait(kind: EnemyKind, sub?: ZombieType): HTMLCanvasElement | null {
  const key = sub ? `${kind}:${sub}` : kind;
  const hit = _cache.get(key);
  if (hit !== undefined) return hit;

  // The engine's palette slot defaults to GREYSCALE until something installs
  // the real one, and the card surfaces paint portraits without booting the
  // dungeon — so a cold-started tavern would draw grey robots instead of rotted
  // corpses, silently. See installPalette.
  installPalette();

  const spec = KIND_PORTRAIT[kind];
  const skin = portraitSkin(kind);
  const cv = spec ? scratch() : null;
  const ctx = cv?.getContext("2d") ?? null;
  if (!spec || !cv || !ctx) {
    _cache.set(key, null);
    return null;
  }

  const sheetKey = SHEET_KEY_BY_KIND[kind];
  const paints: ActorPaints =
    kind === "zombie" && sub
      ? makeZombiePaints(ZOMBIE_VARIANTS[zombieVariantFor(sub)])
      : sheetKey
        ? paintsFor(sheetKey)
        : spec.paints();
  const frames: FramePaint[] | undefined =
    paints.S?.idle ?? paints.E?.idle ?? paints.S?.walk ?? paints.E?.walk;
  const frame = frames?.[0];
  if (!frame) {
    _cache.set(key, null);
    return null;
  }

  frame(ctx);

  // Tint exactly as the spawner does — but the tint must apply ONLY to painted
  // pixels. Doing it in place (`multiply` fillRect, then `destination-in` with
  // the canvas drawn onto itself) tints the transparent background too and then
  // fails to mask it back out, which painted the Wisp as a solid cyan RECTANGLE.
  //
  // `source-in` against a SEPARATE scratch layer is the honest version: fill the
  // layer with the tint, clip it to the sprite's own alpha, then multiply that
  // masked layer down. Transparent stays transparent.
  if (skin.tint !== null) {
    const tintLayer = scratch();
    const tctx = tintLayer?.getContext("2d") ?? null;
    if (tintLayer && tctx) {
      tctx.fillStyle = `#${skin.tint.toString(16).padStart(6, "0")}`;
      tctx.fillRect(0, 0, PX, PX);
      tctx.globalCompositeOperation = "destination-in";
      tctx.drawImage(cv, 0, 0);

      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      ctx.drawImage(tintLayer, 0, 0);
      ctx.restore();
    }
  }

  _cache.set(key, cv);
  return cv;
}

/** The display scale a kind's portrait wants (a hulk should tower, a pin shouldn't). */
export function portraitScale(kind: EnemyKind, sub?: ZombieType): number {
  const base = portraitSkin(kind).scale;
  // Zombie sub-types carry their own body scale, and the whole point of the
  // Hulk/Midget cards is that those two are visibly different monsters. Damped
  // toward 1 so a 1.55× hulk fills the window without clipping out of it.
  if (kind === "zombie" && sub) return base * (1 + (ZOMBIE_TYPES[sub].scale - 1) * 0.55);
  return base;
}

/** Test seam: drop the memoised portraits (used by the unit tests). */
export function _clearPortraitCache(): void {
  _cache.clear();
}
