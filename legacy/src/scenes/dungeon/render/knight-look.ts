/**
 * KNIGHT LOOK — the pure mapping from equipped gear to what the sprite painter
 * draws. DOM/three-free so it unit-tests headlessly.
 *
 * Design rule (see cel-painter's knightHelm): gear presence is expressed as
 * RAMP SWAPS, never geometry removal — the T-visor and the full silhouette are
 * the knight's readability, so an ungeared knight is the same shape in dull
 * dark iron with no plume, and each equipped piece brightens its region:
 *   helmet → polished helm + the blood plume
 *   armor  → bright cuirass/pauldrons/tassets + gold trim
 *   boots  → bright greaves
 */
import type { GearState } from "../items";
import type { WeaponId } from "../items";

export interface KnightLook {
  helmet: boolean;
  armor: boolean;
  boots: boolean;
}

/** The classic fully-plumed knight — the default every legacy caller gets. */
export const FULL_PLATE: KnightLook = Object.freeze({ helmet: true, armor: true, boots: true });

/** A gear piece is VISIBLE while it has any durability left (boots use the
 * `1` equipped-sentinel; a piece destroyed in combat drops to 0 and the
 * knight visibly loses its shine that same frame). */
export function lookFromGear(gear: GearState): KnightLook {
  return {
    helmet: (gear.helmet ?? 0) > 0,
    armor: (gear.armor ?? 0) > 0,
    boots: (gear.boots ?? 0) > 0,
  };
}

/** Stable composite cache key for a (weapon, look) sheet — "sword|101". */
export function lookKey(weapon: WeaponId, look: KnightLook): string {
  return `${weapon}|${look.helmet ? 1 : 0}${look.armor ? 1 : 0}${look.boots ? 1 : 0}`;
}
