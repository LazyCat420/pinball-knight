/**
 * REAGENTS — monster loot materials, the Ragnarok-Online model.
 *
 * In RO a monster drops what it's "made of" (a Poring drops Jellopy, a Golem
 * drops Iron Ore, a Ghoul drops herbs) and you brew those into potions at an
 * Alchemist. We theme our 14 enemy kinds the same way: every EnemyKind maps to
 * the reagent it's built from, and the Tavern Alchemist combines them (+ an
 * Empty Flask catalyst) into potions via recipes.ts.
 *
 * Reagents are RUN-SCOPED — they live in state.reagents and reset on death with
 * the rest of the run (only the wallet gold + legacy perks survive). You gather
 * on a floor and brew at the tavern between floors.
 *
 * DOM- and three-free so the drop-roll math is unit-tested.
 */
import type { EnemyKind } from "./state";

export type ReagentTier = "common" | "uncommon" | "rare";
export type ReagentId =
  | "slimegel"
  | "batwing"
  | "rotflesh"
  | "silk"
  | "hide"
  | "venomsac"
  | "goblintooth"
  | "steelpin"
  | "ironshard"
  | "lodestone"
  | "fang"
  | "ectoplasm"
  | "grimbone"
  | "glass";

export interface ReagentDef {
  id: ReagentId;
  label: string;
  icon: string;
  tier: ReagentTier;
  /** Gem tint on the floor drop + the pouch swatch, sRGB hex. */
  color: string;
  /** What it is / where it comes from, in a few words (single source of truth). */
  description: string;
}

/** Tier accent colours (mirrors the card RARITY_HEX idea in cards.ts). */
export const TIER_HEX: Record<ReagentTier, string> = {
  common: "#9aa4b4",
  uncommon: "#4f8fdb",
  rare: "#a46fe8",
};

export const REAGENTS: Record<ReagentId, ReagentDef> = {
  // ── Common (drop often, off the baseline horde) ──
  slimegel: { id: "slimegel", label: "Slime Gel", icon: "🟢", tier: "common", color: "#7bd47b", description: "jelly from a slime" },
  batwing: { id: "batwing", label: "Bat Wing", icon: "🦇", tier: "common", color: "#8f7bd0", description: "leathery flyer's wing" },
  rotflesh: { id: "rotflesh", label: "Rotten Flesh", icon: "🧟", tier: "common", color: "#8a9a5b", description: "scrap of undead meat" },
  silk: { id: "silk", label: "Sticky Silk", icon: "🕸️", tier: "common", color: "#dfe7f2", description: "spun spider thread" },
  hide: { id: "hide", label: "Coarse Hide", icon: "🐗", tier: "common", color: "#a9744f", description: "a brute's thick skin" },
  // ── Uncommon (off the tougher / specialist kinds) ──
  venomsac: { id: "venomsac", label: "Venom Sac", icon: "🟣", tier: "uncommon", color: "#a83fd0", description: "a spitter's acid gland" },
  goblintooth: { id: "goblintooth", label: "Goblin Tooth", icon: "👺", tier: "uncommon", color: "#d0b23f", description: "a chipped goblin fang" },
  steelpin: { id: "steelpin", label: "Steel Pin", icon: "📌", tier: "uncommon", color: "#b8c0cc", description: "hardened bowling steel" },
  ironshard: { id: "ironshard", label: "Iron Shard", icon: "🪨", tier: "uncommon", color: "#9a8f77", description: "a golem's iron ore" },
  lodestone: { id: "lodestone", label: "Lodestone", icon: "🧲", tier: "uncommon", color: "#c0506a", description: "a magnet crawler's core" },
  fang: { id: "fang", label: "Sharp Fang", icon: "🦷", tier: "uncommon", color: "#e8e0cf", description: "a wicked biter's fang" },
  glass: { id: "glass", label: "Glass Shard", icon: "🔷", tier: "uncommon", color: "#6fd0e8", description: "shatters into flasks" },
  // ── Rare (the elite / cold kinds and bosses) ──
  ectoplasm: { id: "ectoplasm", label: "Cold Ectoplasm", icon: "👻", tier: "rare", color: "#bfe8ff", description: "a ghost's chill residue" },
  grimbone: { id: "grimbone", label: "Grim Bone", icon: "💀", tier: "rare", color: "#e8e6df", description: "bone of the fallen" },
};

export const REAGENT_IDS: ReagentId[] = Object.keys(REAGENTS) as ReagentId[];

/** One weighted drop entry: reagent `id` rolls independently at `chance` (0..1). */
interface DropEntry {
  id: ReagentId;
  chance: number;
}

/**
 * Per-enemy drop table — each kind drops the reagent it's THEMATICALLY made of
 * (RO-style). EXHAUSTIVE by EnemyKind so a new enemy is a compile error here
 * rather than silently dropping nothing (same discipline as combat's bite table).
 */
export const ENEMY_DROPS: Record<EnemyKind, DropEntry[]> = {
  zombie: [{ id: "rotflesh", chance: 0.28 }],
  spider: [{ id: "silk", chance: 0.18 }, { id: "fang", chance: 0.1 }],
  brute: [{ id: "hide", chance: 0.28 }, { id: "rotflesh", chance: 0.08 }],
  spitter: [{ id: "venomsac", chance: 0.2 }],
  ghost: [{ id: "ectoplasm", chance: 0.14 }],
  bat: [{ id: "batwing", chance: 0.28 }],
  slime: [{ id: "slimegel", chance: 0.3 }],
  reaper: [{ id: "grimbone", chance: 0.12 }],
  goblin: [{ id: "goblintooth", chance: 0.16 }],
  pin: [{ id: "steelpin", chance: 0.14 }, { id: "glass", chance: 0.06 }],
  golem: [{ id: "ironshard", chance: 0.2 }, { id: "glass", chance: 0.1 }],
  chomper: [{ id: "slimegel", chance: 0.14 }, { id: "fang", chance: 0.1 }],
  magnet: [{ id: "lodestone", chance: 0.16 }],
  webspinner: [{ id: "silk", chance: 0.28 }],
  sporeling: [{ id: "rotflesh", chance: 0.22 }, { id: "slimegel", chance: 0.12 }],
  jester: [{ id: "steelpin", chance: 0.26 }, { id: "glass", chance: 0.1 }],
  croaker: [{ id: "slimegel", chance: 0.26 }, { id: "glass", chance: 0.12 }],
  rotortail: [{ id: "hide", chance: 0.24 }, { id: "ironshard", chance: 0.12 }],
  // The casing off a bomb it never got to throw, plus the hide off a very tall
  // animal. Ironshard leads because the ordnance is what it is remembered for.
  stiltneck: [{ id: "ironshard", chance: 0.26 }, { id: "hide", chance: 0.16 }],
  fish_feet: [{ id: "hide", chance: 0.24 }, { id: "fang", chance: 0.12 }],
  // ── Expansion roster ──
  hound: [{ id: "fang", chance: 0.24 }, { id: "hide", chance: 0.1 }],
  bloater: [{ id: "venomsac", chance: 0.24 }, { id: "slimegel", chance: 0.14 }],
  necromancer: [{ id: "grimbone", chance: 0.22 }, { id: "ectoplasm", chance: 0.12 }],
  warden: [{ id: "ironshard", chance: 0.2 }, { id: "hide", chance: 0.12 }],
  wisp: [{ id: "ectoplasm", chance: 0.24 }],
  sapper: [{ id: "lodestone", chance: 0.2 }, { id: "glass", chance: 0.1 }],
  crystalback: [{ id: "glass", chance: 0.3 }, { id: "ironshard", chance: 0.12 }],
  mimic: [{ id: "goblintooth", chance: 0.2 }, { id: "steelpin", chance: 0.12 }],
  platypus: [{ id: "ironshard", chance: 0.28 }, { id: "hide", chance: 0.14 }],
  espresso: [{ id: "glass", chance: 0.25 }, { id: "slimegel", chance: 0.15 }],
  gnome: [{ id: "ironshard", chance: 0.28 }, { id: "steelpin", chance: 0.14 }],
  jade_buddha: [{ id: "glass", chance: 0.5 }, { id: "lodestone", chance: 0.3 }],
};

/**
 * Roll the reagent drops for a slain enemy. Each entry in the kind's table rolls
 * independently, so a kill yields 0..N materials. A boss is a jackpot: it always
 * yields a Grim Bone plus a second pass over its kind's table.
 *
 * `rand` is injectable so the drop is testable; defaults to Math.random.
 */
export function rollReagentDrops(
  kind: EnemyKind,
  opts: { boss?: boolean; dropMult?: number } = {},
  rand: () => number = Math.random,
): ReagentId[] {
  const table = ENEMY_DROPS[kind] ?? [];
  const out: ReagentId[] = [];
  // A zombie SUB-TYPE weights its own loot (zombie-types.ts typeDropMult): a
  // 9-HP hulk should not pay a 2-HP midget's wage. Clamped to 1 so a large
  // multiplier can never turn a chance roll into a guarantee.
  const mult = opts.dropMult ?? 1;
  const roll = (entries: DropEntry[]): void => {
    for (const e of entries) if (rand() < Math.min(1, e.chance * mult)) out.push(e.id);
  };
  roll(table);
  if (opts.boss) {
    out.push("grimbone"); // guaranteed elite reagent
    roll(table); // a second helping from whatever it was
  }
  return out;
}
