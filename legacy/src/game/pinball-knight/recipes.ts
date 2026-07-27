/**
 * RECIPES — the Alchemist's brew book (Ragnarok "Prepare Potion" model).
 *
 * A recipe turns monster REAGENTS (reagents.ts) plus an Empty Flask catalyst
 * (state.flasks) into a potion (items.ts POTIONS). Rarer reagents gate stronger
 * brews — the same escalation RO uses (Red Herb → Red Potion; White Herb, Blue
 * Herb → the strong stuff). Brewing lives at the Tavern Alchemist (tavern.ts);
 * this file is just the pure table + the can-afford / consume arithmetic (tested).
 *
 * The one special case is `flask`: the bootstrap recipe that makes the catalyst
 * itself out of Glass Shards, so its own flask cost is 0.
 */
import type { PotionId } from "./items";
import type { ReagentId, ReagentTier } from "./reagents";

/** What a recipe yields — a potion, or the Empty Flask catalyst itself. */
export type RecipeOutput = PotionId | "flask";
export type RecipeId = string;

export interface RecipeDef {
  id: RecipeId;
  /** Row label + the pouch/belt icon (mirrors the output's icon). */
  label: string;
  icon: string;
  output: RecipeOutput;
  /** Reagent cost: ReagentId → count consumed. */
  inputs: Partial<Record<ReagentId, number>>;
  /** Empty Flask catalyst cost (usually 1; 0 for the flask recipe itself). */
  flasks: number;
  /** Optional gold fee on top of the materials. */
  gold?: number;
  /** Grouping / display tier — the strongest reagent the recipe needs. */
  tier: ReagentTier;
}

export const RECIPES: Record<RecipeId, RecipeDef> = {
  // ── Bootstrap: glass → the catalyst everything else needs ──
  flask: { id: "flask", label: "Empty Flask", icon: "🧴", output: "flask", inputs: { glass: 3 }, flasks: 0, tier: "uncommon" },

  // ── Re-craft the classic potions (outputs already in POTIONS) ──
  health: { id: "health", label: "Health", icon: "❤️", output: "health", inputs: { slimegel: 2, rotflesh: 1 }, flasks: 1, tier: "common" },
  haste: { id: "haste", label: "Haste", icon: "⚡", output: "haste", inputs: { batwing: 2 }, flasks: 1, tier: "common" },
  rage: { id: "rage", label: "Rage", icon: "💢", output: "rage", inputs: { venomsac: 1, hide: 1 }, flasks: 1, tier: "uncommon" },
  shield: { id: "shield", label: "Shield", icon: "🛡️", output: "shield", inputs: { ironshard: 1, lodestone: 1 }, flasks: 1, tier: "uncommon" },
  curveshot: { id: "curveshot", label: "Curve Shot", icon: "🌀", output: "curveshot", inputs: { silk: 1, fang: 1 }, flasks: 1, tier: "uncommon" },
  magnetboots: { id: "magnetboots", label: "Magnet Boots", icon: "🧲", output: "magnetboots", inputs: { lodestone: 2 }, flasks: 1, tier: "uncommon" },
  ballform: { id: "ballform", label: "Ball Form", icon: "🪩", output: "ballform", inputs: { ironshard: 1, lodestone: 1, steelpin: 1 }, flasks: 1, tier: "uncommon" },
  freeze: { id: "freeze", label: "Freeze", icon: "❄️", output: "freeze", inputs: { ectoplasm: 1, silk: 2 }, flasks: 1, tier: "rare" },
  multiball: { id: "multiball", label: "Multi-Ball", icon: "🔮", output: "multiball", inputs: { lodestone: 1, ectoplasm: 1 }, flasks: 1, tier: "rare" },

  // ── Craft-only brews (no shop row, no floor spawn) ──
  regen: { id: "regen", label: "Regen Salve", icon: "🧪", output: "regen", inputs: { slimegel: 3 }, flasks: 1, tier: "common" },
  venomcoat: { id: "venomcoat", label: "Venom Coat", icon: "☠️", output: "venomcoat", inputs: { venomsac: 2 }, flasks: 1, tier: "uncommon" },
  stoneskin: { id: "stoneskin", label: "Stoneskin", icon: "🪨", output: "stoneskin", inputs: { ironshard: 2, lodestone: 1 }, flasks: 1, tier: "uncommon" },
  static: { id: "static", label: "Static Charge", icon: "⚡", output: "static", inputs: { lodestone: 2, steelpin: 1 }, flasks: 1, tier: "uncommon" },
  greed: { id: "greed", label: "Greed Draught", icon: "💰", output: "greed", inputs: { goblintooth: 3 }, flasks: 1, tier: "uncommon" },
  elixir: { id: "elixir", label: "Elixir of Life", icon: "🌟", output: "elixir", inputs: { grimbone: 1, ectoplasm: 1, slimegel: 2 }, flasks: 2, gold: 40, tier: "rare" },
};

export const RECIPE_IDS: RecipeId[] = Object.keys(RECIPES);

/** A read-only view of the run pouch (ReagentId → count). Missing = 0. */
export type Pouch = Partial<Record<ReagentId, number>>;

/** Do you have the reagents + flasks (+ gold) this recipe needs? Pure. */
export function canCraft(r: RecipeDef, pouch: Pouch, flasks: number, gold = Infinity): boolean {
  if (flasks < r.flasks) return false;
  if ((r.gold ?? 0) > gold) return false;
  for (const [id, need] of Object.entries(r.inputs) as Array<[ReagentId, number]>) {
    if ((pouch[id] ?? 0) < need) return false;
  }
  return true;
}

/**
 * The cost to pay for one craft — the caller subtracts these from the run pouch,
 * flask counter and wallet. Returned rather than mutated so it stays pure/tested;
 * the tavern applies it (and adds the output potion / flask) on a confirmed brew.
 */
export function craftCost(r: RecipeDef): { inputs: Array<[ReagentId, number]>; flasks: number; gold: number } {
  return {
    inputs: Object.entries(r.inputs) as Array<[ReagentId, number]>,
    flasks: r.flasks,
    gold: r.gold ?? 0,
  };
}
