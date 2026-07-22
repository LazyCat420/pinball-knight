/**
 * KNIGHT LOOK — the pure mapping from equipped gear to what the sprite painter
 * draws. DOM/three-free so it unit-tests headlessly.
 *
 * Design rule (see cel-painter's knightHelm): gear presence is expressed as
 * RAMP SWAPS, never geometry removal — the T-visor and the full silhouette are
 * the knight's readability, so an ungeared knight is the same shape in dull
 * dark iron with no plume, and each equipped piece brightens its region:
 *   helmet → polished helm + the crest plume
 *   armor  → bright cuirass/pauldrons/tassets + trim
 *   boots  → bright greaves
 *
 * The STYLE (armor-styles.ts) picks WHICH ramps the equipped pieces brighten
 * to — Crypt Iron steel by default, or an unlocked elemental set. It rides the
 * look (and therefore the sheet cache key), so wearing a new set re-dresses
 * every consumer through the exact per-frame key checks gear swaps already use.
 */
import type { GearState } from "../items";
import type { WeaponId } from "../items";
import { activeStyle, type ArmorStyleId } from "../armor-styles";

export interface KnightLook {
  helmet: boolean;
  armor: boolean;
  boots: boolean;
  /** Which set the worn pieces paint as. Absent = "iron" (legacy callers). */
  style?: ArmorStyleId;
}

/** The classic fully-plumed knight — the default every legacy caller gets. */
export const FULL_PLATE: KnightLook = Object.freeze({ helmet: true, armor: true, boots: true });

/** A gear piece is VISIBLE while it has any durability left (boots use the
 * `1` equipped-sentinel; a piece destroyed in combat drops to 0 and the
 * knight visibly loses its shine that same frame). The worn armor STYLE is
 * read from armor-styles unless the caller pins one (tests, previews). */
export function lookFromGear(gear: GearState, style: ArmorStyleId = activeStyle()): KnightLook {
  return {
    helmet: (gear.helmet ?? 0) > 0,
    armor: (gear.armor ?? 0) > 0,
    boots: (gear.boots ?? 0) > 0,
    style,
  };
}

/** Stable composite cache key for a (weapon, look) sheet — "sword|101|ice".
 * The style ALWAYS appears (absent = iron) so two styles never collide. */
export function lookKey(weapon: WeaponId, look: KnightLook): string {
  return `${weapon}|${look.helmet ? 1 : 0}${look.armor ? 1 : 0}${look.boots ? 1 : 0}|${look.style ?? "iron"}`;
}
