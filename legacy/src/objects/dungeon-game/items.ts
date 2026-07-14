/**
 * Weapons & gear — the item tables and the durability rules.
 *
 * Weapons: every swing that CONNECTS costs 1 durability; at 0 the weapon
 * breaks and you fight with your fists until you pick something else up.
 * Fists are the unbreakable floor of the system, not an item.
 *
 * Gear (one of each slot per level, v1): helmet and armor are ablative — each
 * point of incoming damage consumes a point of that piece's durability before
 * touching hearts, helmet first. Boots don't absorb; they make you faster.
 *
 * DOM- and three-free: the durability math is tested.
 */

export type WeaponId = "fists" | "sword" | "stick" | "mace" | "chair";

export interface WeaponDef {
  id: WeaponId;
  label: string;
  icon: string; // HUD emoji
  damage: number;
  range: number;
  /** cos of the half-arc — smaller means a wider swing. */
  arcCos: number;
  cooldown: number;
  /** Swings-that-connect before it breaks. Infinity = unbreakable (fists). */
  maxDurability: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  fists: { id: "fists", label: "Fists", icon: "✊", damage: 1, range: 0.85, arcCos: 0.5, cooldown: 0.3, maxDurability: Infinity },
  sword: { id: "sword", label: "Sword", icon: "🗡️", damage: 2, range: 1.35, arcCos: 0.5, cooldown: 0.38, maxDurability: 30 },
  stick: { id: "stick", label: "Stick", icon: "🪵", damage: 1, range: 1.2, arcCos: 0.5, cooldown: 0.24, maxDurability: 15 },
  mace: { id: "mace", label: "Mace", icon: "🔨", damage: 3, range: 1.25, arcCos: 0.55, cooldown: 0.62, maxDurability: 45 },
  chair: { id: "chair", label: "Chair", icon: "🪑", damage: 2, range: 1.5, arcCos: 0.0, cooldown: 0.7, maxDurability: 10 },
};

/** The weapons that spawn as maze pickups (you start with the sword). */
export const PICKUP_WEAPONS: WeaponId[] = ["stick", "mace", "chair"];

export interface WeaponState {
  id: WeaponId;
  durability: number;
}

export function freshWeapon(id: WeaponId): WeaponState {
  return { id, durability: WEAPONS[id].maxDurability };
}

/**
 * A swing connected: wear the weapon down 1 point. Returns the next weapon
 * state and whether this swing broke it (the swing itself still lands —
 * things break ON use, not instead of use).
 */
export function degradeWeapon(w: WeaponState): { weapon: WeaponState; broke: boolean } {
  if (!Number.isFinite(w.durability)) return { weapon: w, broke: false };
  const durability = w.durability - 1;
  if (durability <= 0) return { weapon: freshWeapon("fists"), broke: true };
  return { weapon: { id: w.id, durability }, broke: false };
}

// ── Gear ────────────────────────────────────────────────────────

export type GearSlot = "helmet" | "armor" | "boots";

export interface GearDef {
  slot: GearSlot;
  label: string;
  icon: string;
  /** Damage the piece can soak over its lifetime. 0 = doesn't absorb (boots). */
  absorb: number;
}

export const GEAR: Record<GearSlot, GearDef> = {
  helmet: { slot: "helmet", label: "Helmet", icon: "🪖", absorb: 3 },
  armor: { slot: "armor", label: "Armor", icon: "🛡️", absorb: 5 },
  boots: { slot: "boots", label: "Boots", icon: "👟", absorb: 0 },
};

export const GEAR_SLOTS: GearSlot[] = ["helmet", "armor", "boots"];

/** Remaining durability per equipped slot; absent key = nothing equipped. */
export type GearState = Partial<Record<GearSlot, number>>;

/**
 * Route incoming damage through the armor, helmet first. Each absorbed point
 * costs the piece a point of durability; a piece at 0 is destroyed (its key is
 * removed). Whatever the gear can't soak comes back as `hpDamage`.
 *
 * Pure — returns a new GearState rather than mutating.
 */
export function absorbDamage(
  gear: GearState,
  damage: number,
): { gear: GearState; hpDamage: number; destroyed: GearSlot[] } {
  const next: GearState = { ...gear };
  const destroyed: GearSlot[] = [];
  let remaining = damage;

  for (const slot of ["helmet", "armor"] as const) {
    if (remaining <= 0) break;
    const dur = next[slot];
    if (dur === undefined || dur <= 0) continue;
    const soaked = Math.min(dur, remaining);
    remaining -= soaked;
    if (dur - soaked <= 0) {
      delete next[slot];
      destroyed.push(slot);
    } else {
      next[slot] = dur - soaked;
    }
  }

  return { gear: next, hpDamage: remaining, destroyed };
}
