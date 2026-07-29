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
  ZOMBIE_VARIANTS,
  type ActorPaints,
  type FramePaint,
} from "./cel-painter";
import { ART_PX } from "../constants";
import { installPalette } from "./palette";
import { ZOMBIE_TYPES, variantIndicesFor, type ZombieType } from "../zombie-types";
import type { EnemyKind } from "../state";
import { makeSporelingPaints } from "./monsters/sporeling";
import { makeJesterPaints } from "./monsters/jester";
import { makeCroakerPaints } from "./monsters/croaker";
import { makeRotortailPaints } from "./monsters/rotortail";
import { makeStiltneckPaints } from "./monsters/stiltneck";
import { makeHoundPaints } from "./monsters/hound";

/** The box every cel painter draws into (128) — portraits blit out of this. */
const PX = ART_PX;

/**
 * Which painter each monster wears, plus the tint and display scale that make
 * it read as ITSELF rather than as the sheet it borrows.
 *
 * `tint` is a multiply pass over the painted cel, matching the runtime
 * `sprite.setTint()` the spawner applies. `null` = the art already carries the
 * creature's identity and must not be recoloured.
 *
 * EXHAUSTIVE by EnemyKind on purpose — same discipline as ENEMY_DROPS and
 * KIND_INFO. Adding a monster should fail to compile here.
 */
const KIND_PORTRAIT: Record<EnemyKind, { paints: () => ActorPaints; tint: number | null; scale: number }> = {
  // ── Core roster: bespoke art, no tint ──
  zombie: { paints: () => makeZombiePaints(ZOMBIE_VARIANTS[0]), tint: null, scale: 1.0 },
  spider: { paints: makeSpiderPaints, tint: null, scale: 1.0 },
  brute: { paints: makeBrutePaints, tint: null, scale: 1.05 },
  spitter: { paints: makeSpitterPaints, tint: null, scale: 1.0 },
  ghost: { paints: makeGhostPaints, tint: null, scale: 1.0 },
  bat: { paints: makeBatPaints, tint: null, scale: 1.0 },
  slime: { paints: makeSlimePaints, tint: null, scale: 1.0 },
  sporeling: { paints: makeSporelingPaints, tint: null, scale: 1.0 },
  jester: { paints: makeJesterPaints, tint: null, scale: 1.0 },
  croaker: { paints: makeCroakerPaints, tint: null, scale: 1.0 },
  rotortail: { paints: makeRotortailPaints, tint: null, scale: 1.0 },
  stiltneck: { paints: makeStiltneckPaints, tint: null, scale: 1.1 },
  hound: { paints: makeHoundPaints, tint: null, scale: 1.05 },
  reaper: { paints: makeReaperPaints, tint: null, scale: 1.05 },
  goblin: { paints: makeGoblinPaints, tint: null, scale: 1.0 },
  pin: { paints: makePinPaints, tint: null, scale: 0.85 },
  golem: { paints: makeGolemPaints, tint: null, scale: 1.12 },
  chomper: { paints: makeChomperPaints, tint: null, scale: 1.1 },
  magnet: { paints: makeMagnetPaints, tint: null, scale: 0.95 },
  webspinner: { paints: makeWebspinnerPaints, tint: null, scale: 1.05 },

  // ── Expansion roster: borrowed sheet + tint. These MUST stay in step with
  //    core.ts EXPANSION_SKIN, or the card lies about what you're hunting.
  //    (`hound` graduated to bespoke art — it sits with the core roster above.) ──
  bloater: { paints: makeSlimePaints, tint: 0xb6c24a, scale: 1.3 },
  necromancer: { paints: makeSpitterPaints, tint: 0x8a5cd0, scale: 1.05 },
  warden: { paints: makeBrutePaints, tint: 0x4f8fdb, scale: 1.05 },
  wisp: { paints: makeGhostPaints, tint: 0x6fe8e8, scale: 0.9 },
  sapper: { paints: makeMagnetPaints, tint: 0xf0e05a, scale: 0.95 },
  crystalback: { paints: makeGolemPaints, tint: 0x8fdfff, scale: 1.12 },
  mimic: { paints: makeGolemPaints, tint: 0xd9a441, scale: 0.8 },
};

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
  const cv = spec ? scratch() : null;
  const ctx = cv?.getContext("2d") ?? null;
  if (!spec || !cv || !ctx) {
    _cache.set(key, null);
    return null;
  }

  const paints: ActorPaints =
    kind === "zombie" && sub ? makeZombiePaints(ZOMBIE_VARIANTS[zombieVariantFor(sub)]) : spec.paints();
  const frames: FramePaint[] | undefined = paints.S?.idle ?? paints.S?.walk;
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
  if (spec.tint !== null) {
    const tintLayer = scratch();
    const tctx = tintLayer?.getContext("2d") ?? null;
    if (tintLayer && tctx) {
      tctx.fillStyle = `#${spec.tint.toString(16).padStart(6, "0")}`;
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
  const base = KIND_PORTRAIT[kind]?.scale ?? 1;
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
