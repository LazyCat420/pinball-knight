/**
 * ARMOR STYLES — elemental plate SETS sold at the Tavern Armorer.
 *
 * A style is a permanent unlock (localStorage, legacy.ts pattern — it survives
 * death like wallet gold does) that re-skins the knight's plate everywhere the
 * sprite is painted: dungeon, walkable tavern, multiball echoes, paperdolls.
 * One style is ACTIVE at a time; "iron" is the free classic default.
 *
 * Tuning intent (matches the legacy-perk philosophy): these are PRESTIGE
 * purchases. At GOLD_PER_KILL=2 a set costs hundreds of kills — several runs of
 * banked savings, not an impulse buy. The mechanical edge is real but modest:
 * while an elemental style is worn, the Armorer's plate is finer steel
 * (helmet/armor soak a little more per purchase). The LOOK is the product.
 *
 * Pure data + fail-soft persistence — DOM/three-free so it unit-tests headlessly.
 */

export type ArmorStyleId = "iron" | "ice" | "wind" | "fire" | "thunder";

export interface ArmorStyleDef {
  id: ArmorStyleId;
  label: string;
  icon: string;
  /** Wallet gold to unlock, forever. 0 = always owned (iron). */
  price: number;
  /** UI swatch (armorer row chip) — matches the sprite's plate mid tone. */
  swatch: string;
  blurb: string;
  /** Extra soak the Armorer's plate carries while this style is worn. */
  bonusAbsorb: { helmet: number; armor: number };
}

export const ARMOR_STYLES: Record<ArmorStyleId, ArmorStyleDef> = {
  iron: { id: "iron", label: "Crypt Iron", icon: "🛡️", price: 0, swatch: "#8a94a6", blurb: "the classic plate you marched in with", bonusAbsorb: { helmet: 0, armor: 0 } },
  ice: { id: "ice", label: "Glacier Plate", icon: "❄️", price: 600, swatch: "#6fd0e8", blurb: "hoarfrost steel, cold-blue sheen", bonusAbsorb: { helmet: 2, armor: 3 } },
  wind: { id: "wind", label: "Gale Plate", icon: "🌪️", price: 600, swatch: "#8fc46b", blurb: "jade-green tempest steel", bonusAbsorb: { helmet: 2, armor: 3 } },
  fire: { id: "fire", label: "Ember Plate", icon: "🔥", price: 750, swatch: "#f0a63c", blurb: "forge-hot plate, ember glow", bonusAbsorb: { helmet: 2, armor: 3 } },
  thunder: { id: "thunder", label: "Storm Plate", icon: "⚡", price: 900, swatch: "#ffd98a", blurb: "storm-slate chased with lightning gold", bonusAbsorb: { helmet: 2, armor: 3 } },
};

export const ARMOR_STYLE_IDS: ArmorStyleId[] = ["iron", "ice", "wind", "fire", "thunder"];
/** The purchasable elemental sets, in shop order. */
export const ELEMENTAL_STYLE_IDS: ArmorStyleId[] = ["ice", "wind", "fire", "thunder"];

function isStyleId(v: unknown): v is ArmorStyleId {
  return typeof v === "string" && (ARMOR_STYLE_IDS as string[]).includes(v);
}

// ── Persistence (best-depth.ts pattern: one key, shape-validated, fail-soft) ──

const KEY = "pinball-knight-armor-styles";

interface StyleState {
  unlocked: ArmorStyleId[];
  active: ArmorStyleId;
}

let cached: StyleState | null = null;

function load(): StyleState {
  if (cached) return cached;
  const out: StyleState = { unlocked: [], active: "iron" };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Record<string, unknown>;
      if (Array.isArray(p.unlocked)) out.unlocked = p.unlocked.filter(isStyleId);
      if (isStyleId(p.active)) out.active = p.active;
    }
  } catch (_e) {
    // Blocked storage → session-only styles; buying still works in-memory.
  }
  // Active must be something you own — a corrupt blob never paints a locked set.
  if (out.active !== "iron" && !out.unlocked.includes(out.active)) out.active = "iron";
  cached = out;
  return out;
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cached ?? { unlocked: [], active: "iron" }));
  } catch (_e) {
    // Session-only is fine.
  }
}

/** The style the knight paints in right now ("iron" until a set is worn). */
export function activeStyle(): ArmorStyleId {
  return load().active;
}

export function isStyleUnlocked(id: ArmorStyleId): boolean {
  return id === "iron" || load().unlocked.includes(id);
}

/** Record a bought set (caller pays the gold) and wear it immediately. */
export function unlockStyle(id: ArmorStyleId): void {
  const st = load();
  if (id !== "iron" && !st.unlocked.includes(id)) st.unlocked.push(id);
  st.active = id;
  save();
}

/** Wear an owned style (no-op on a locked one). Returns whether it applied. */
export function setActiveStyle(id: ArmorStyleId): boolean {
  if (!isStyleUnlocked(id)) return false;
  const st = load();
  st.active = id;
  save();
  return true;
}

/**
 * Soak the Armorer grants when selling `slot` plate under the worn style —
 * base GEAR soak plus the style's finer-steel bonus (boots keep the `1`
 * equipped-sentinel; they never absorb). Floor-found plate stays base iron
 * values regardless of style — the style is a skin over whatever you wear.
 */
export function styleGearGrant(slot: "helmet" | "armor" | "boots", base: number, id: ArmorStyleId = activeStyle()): number {
  if (slot === "boots") return base;
  return base + ARMOR_STYLES[id].bonusAbsorb[slot];
}

/** Test seam. */
export function __resetArmorStylesCache(): void {
  cached = null;
}
