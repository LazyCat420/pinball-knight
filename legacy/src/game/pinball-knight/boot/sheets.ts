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
 * Build every monster atlas once per session. A handful of atlases is cheap;
 * the zombie VARIANTS exist so a horde doesn't read as clones.
 */
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

export function buildMonsterSheets(): void {
  // ── Sprite sheets (the knight's is per-weapon) ──
  // A small pool of cosmetic zombie variants (ripped rags, gore, stumps, tone)
  // so a horde doesn't read as clones. Each spawn picks one by seed. Built once
  // per session — a handful of atlases is cheap.
  state.zombieVariantSheets = ZOMBIE_VARIANTS.map((v) => monsterSheet(makeZombiePaints(v)));
  state.zombieSheet = state.zombieVariantSheets[0]; // legacy single-sheet handle
  state.spiderSheet = monsterSheet(makeSpiderPaints());
  state.bruteSheet = monsterSheet(makeBrutePaints());
  state.spitterSheet = monsterSheet(makeSpitterPaints());
  state.ghostSheet = monsterSheet(makeGhostPaints());
  state.batSheet = monsterSheet(makeBatPaints());
  state.slimeSheet = monsterSheet(makeSlimePaints());
  state.bossSheet = monsterSheet(makeBossPaints());
  // Wave-B bespoke monster atlases (were tinted reskins).
  state.goblinSheet = monsterSheet(makeGoblinPaints());
  state.pinSheet = monsterSheet(makePinPaints());
  state.golemSheet = monsterSheet(makeGolemPaints());
  state.chomperSheet = monsterSheet(makeChomperPaints());
  state.magnetSheet = monsterSheet(makeMagnetPaints());
  state.webspinnerSheet = monsterSheet(makeWebspinnerPaints());
}
