/**
 * Weapons & gear — the item tables and the durability rules.
 *
 * Weapons come in two kinds:
 *  - MELEE: every swing that CONNECTS costs 1 durability.
 *  - RANGED: every SHOT costs 1 durability — durability IS the ammo/fuel.
 * At 0 the weapon is gone. Fists are the unbreakable floor of the system,
 * not an item: they're what an empty hand resolves to.
 *
 * The player carries up to TWO weapons (slots) and swaps between them; the
 * slot logic itself lives in core.ts/state.ts — this file is just the tables
 * and the pure durability math (tested).
 *
 * Gear (one of each slot per level, v1): helmet and armor are ablative — each
 * point of incoming damage consumes a point of that piece's durability before
 * touching hearts, helmet first. Boots don't absorb; they make you faster.
 *
 * DOM- and three-free: the durability math is tested.
 */

export type WeaponId = "fists" | "sword" | "stick" | "mace" | "chair" | "gun" | "bow" | "flamethrower";

export type WeaponKind = "melee" | "ranged";
export type ProjectileKind = "bullet" | "arrow" | "flame" | "glob" | "web" | "shard";

export interface WeaponDef {
  id: WeaponId;
  label: string;
  icon: string; // HUD emoji
  kind: WeaponKind;
  damage: number;
  /** Melee: swing reach. Ranged: max projectile travel, in tiles. */
  range: number;
  /** cos of the half-arc — smaller means a wider swing. Melee only. */
  arcCos: number;
  cooldown: number;
  /** Uses before it's gone. Melee wears on hit, ranged spends per shot. Infinity = fists. */
  maxDurability: number;
  /** Ranged only — what leaves the muzzle and how. */
  projectile?: ProjectileKind;
  projectileSpeed?: number;
  /** Aim jitter, radians. The flamethrower's spray IS this. */
  spread?: number;
  /** Projectiles per trigger pull (the flamethrower spits a pair of puffs). */
  pellets?: number;
  /** Melee slash-arc VFX tint (sRGB hex). Defaults to a cold steel white. */
  slashColor?: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  fists: { id: "fists", label: "Fists", icon: "✊", kind: "melee", damage: 1, range: 0.85, arcCos: 0.5, cooldown: 0.3, maxDurability: Infinity, slashColor: 0xc8ccd4 },
  sword: { id: "sword", label: "Sword", icon: "🗡️", kind: "melee", damage: 2, range: 1.35, arcCos: 0.5, cooldown: 0.38, maxDurability: 30, slashColor: 0xeef1f5 },
  stick: { id: "stick", label: "Stick", icon: "🪵", kind: "melee", damage: 1, range: 1.2, arcCos: 0.5, cooldown: 0.24, maxDurability: 15, slashColor: 0x6b4a2e },
  mace: { id: "mace", label: "Mace", icon: "🔨", kind: "melee", damage: 3, range: 1.25, arcCos: 0.55, cooldown: 0.62, maxDurability: 45, slashColor: 0xffd98a },
  chair: { id: "chair", label: "Chair", icon: "🪑", kind: "melee", damage: 2, range: 1.5, arcCos: 0.0, cooldown: 0.7, maxDurability: 10, slashColor: 0x6b4a2e },
  gun: { id: "gun", label: "Gun", icon: "🔫", kind: "ranged", damage: 2, range: 10, arcCos: 1, cooldown: 0.32, maxDurability: 30, projectile: "bullet", projectileSpeed: 16, spread: 0.04 },
  bow: { id: "bow", label: "Bow", icon: "🏹", kind: "ranged", damage: 3, range: 8.5, arcCos: 1, cooldown: 0.72, maxDurability: 16, projectile: "arrow", projectileSpeed: 11, spread: 0 },
  flamethrower: { id: "flamethrower", label: "Flamer", icon: "🔥", kind: "ranged", damage: 1, range: 3.4, arcCos: 1, cooldown: 0.085, maxDurability: 110, projectile: "flame", projectileSpeed: 4.6, spread: 0.3, pellets: 2 },
};

/** The weapons that spawn as maze pickups (you start with the sword). */
export const PICKUP_WEAPONS: WeaponId[] = ["stick", "mace", "chair", "gun", "bow", "flamethrower"];

export interface WeaponState {
  id: WeaponId;
  durability: number;
}

export function freshWeapon(id: WeaponId): WeaponState {
  return { id, durability: WEAPONS[id].maxDurability };
}

/**
 * One use of the weapon: a melee swing that connected, or a shot fired.
 * Returns the worn state and whether that use finished it off (the use itself
 * still lands — things break ON use, not instead of use). What happens to a
 * broken weapon (the slot empties, the hand falls back to fists) is the
 * caller's business — this is just the arithmetic.
 */
export function degradeWeapon(w: WeaponState): { weapon: WeaponState; broke: boolean } {
  if (!Number.isFinite(w.durability)) return { weapon: w, broke: false };
  const durability = w.durability - 1;
  return { weapon: { id: w.id, durability }, broke: durability <= 0 };
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

// ── Potions — walk-over consumables ─────────────────────────────
//
// A third pickup family beside weapons and gear. Two flavours of effect:
//  - INSTANT: healing, applied the moment you grab it (heal potion).
//  - TIMED BUFF: rage (2× damage) and haste (faster move + swing) run for a
//    duration, tracked on the player and ticked down each frame. Grabbing the
//    same buff again refreshes its timer rather than stacking.

export type PotionId =
  | "health"
  | "rage"
  | "haste"
  | "shield"
  | "gold"
  | "ironcore"
  | "turbo"
  | "springlegs"
  | "freeze"
  | "multiball";

export interface PotionDef {
  id: PotionId;
  label: string;
  icon: string;
  /** Sprite tint / liquid colour, sRGB hex — also the HUD swatch. */
  color: number;
  /** Instant hearts restored (0 for pure-buff potions). */
  heal: number;
  /** Timed-buff duration, seconds (0 for instant potions). */
  duration: number;
  /** Instant gold granted (the greed idol). 0 for everything else. */
  gold?: number;
}

export const POTIONS: Record<PotionId, PotionDef> = {
  health: { id: "health", label: "Health", icon: "❤️", color: 0xd95763, heal: 3, duration: 0 },
  rage: { id: "rage", label: "Rage", icon: "💢", color: 0xd97b29, heal: 0, duration: 12 },
  haste: { id: "haste", label: "Haste", icon: "⚡", color: 0x6fd0e8, heal: 0, duration: 12 },
  // Shield: a bubble of invulnerability — walk through a horde untouched for a
  // few seconds. The escape-hatch power-up.
  shield: { id: "shield", label: "Shield", icon: "🛡️", color: 0x8fc46b, heal: 0, duration: 6 },
  // Greed idol: not a liquid — an instant gold windfall. Reads as a golden flask.
  gold: { id: "gold", label: "Idol", icon: "💰", color: 0xffd98a, heal: 0, duration: 0, gold: 25 },
  // ── The pinball power-ups (Wave F) ──
  // Iron Core: pure ball mode — ramming at ANY momentum, at triple damage.
  ironcore: { id: "ironcore", label: "Iron Core", icon: "🔩", color: 0x8a94a6, heal: 0, duration: 20 },
  // Turbo Charge: the momentum never bleeds and the ball actually steers.
  turbo: { id: "turbo", label: "Turbo", icon: "🚀", color: 0xf0a63c, heal: 0, duration: 10 },
  // Spring Legs: every flat wall bounce GAINS speed — compound bouncing.
  springlegs: { id: "springlegs", label: "Spring Legs", icon: "🦵", color: 0x8fc46b, heal: 0, duration: 15 },
  // Freeze Ray: the whole machine holds its breath — thread the bumper room.
  freeze: { id: "freeze", label: "Freeze", icon: "❄️", color: 0xbfe8ff, heal: 0, duration: 6 },
  // Multi-Ball: two ghost knights mirror the run and ram what they touch.
  multiball: { id: "multiball", label: "Multi-Ball", icon: "🔮", color: 0xb06fe8, heal: 0, duration: 12 },
};

export const POTION_IDS: PotionId[] = ["health", "rage", "haste", "shield", "gold", "ironcore", "turbo", "springlegs", "freeze", "multiball"];

/** Multipliers applied while a buff is active. */
export const RAGE_DAMAGE_MULT = 2;
export const HASTE_SPEED_MULT = 1.45;
export const HASTE_COOLDOWN_MULT = 0.6; // attacks come out faster too

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
