/**
 * LEGACY PERKS — the permanent half of the hybrid progression. A handful of
 * SMALL lifetime bonuses bought with banked wallet gold from the menu's Skills
 * tab. They survive death (localStorage, best-depth.ts pattern) and enter the
 * skill aggregate as its BASE, so there is exactly one effect pipeline.
 *
 * Tuning intent: costs steep (a long-term gold sink beside the casino), effects
 * small (single-digit percentages) — floors must never trivialize just because
 * the player has died a lot.
 */
import { type SkillModifier } from "./skills";

export type PerkId = string;

export interface LegacyPerkDef {
  id: PerkId;
  label: string;
  icon: string;
  description: string;
  /** Wallet gold per rank. */
  cost: number;
  maxRank: number;
  modifier: SkillModifier;
  /** Start each run with one random common card in the stash (special-cased). */
  startCard?: boolean;
}

export const LEGACY_PERKS: Record<PerkId, LegacyPerkDef> = {
  oldscar: { id: "oldscar", label: "Old Scar", icon: "❤️", cost: 400, maxRank: 1, description: "+1 max heart, forever", modifier: { maxHpFlat: 1 } },
  veteran: { id: "veteran", label: "Veteran's Eye", icon: "📜", cost: 250, maxRank: 2, description: "+10% XP per rank, forever", modifier: { xpMult: 1.1 } },
  luckycoin: { id: "luckycoin", label: "Lucky Coin", icon: "🪙", cost: 300, maxRank: 2, description: "coins worth +5% per rank, forever", modifier: { goldMult: 1.05 } },
  heirloomedge: { id: "heirloomedge", label: "Heirloom Edge", icon: "⚔️", cost: 500, maxRank: 1, description: "+5% damage, forever", modifier: { damageMult: 1.05 } },
  packrat: { id: "packrat", label: "Pack Rat", icon: "🃏", cost: 350, maxRank: 1, description: "start every run with a random common card", modifier: {}, startCard: true },
};

export const PERK_IDS: PerkId[] = Object.keys(LEGACY_PERKS);

// ── Persistence (best-depth.ts pattern: one key, shape-validated, fail-soft) ──

const KEY = "pinball-knight-legacy";

export type LegacyState = Record<PerkId, number>;

let cached: LegacyState | null = null;

export function loadLegacy(): LegacyState {
  if (cached) return cached;
  const out: LegacyState = {};
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Record<string, unknown>;
      for (const id of PERK_IDS) {
        const v = p[id];
        if (typeof v === "number" && Number.isFinite(v) && v > 0) {
          out[id] = Math.min(Math.floor(v), LEGACY_PERKS[id].maxRank);
        }
      }
    }
  } catch (_e) {
    // Blocked storage → no perks this session; buying still works in-memory.
  }
  cached = out;
  return out;
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cached ?? {}));
  } catch (_e) {
    // Session-only is fine.
  }
}

export function perkRank(id: PerkId): number {
  return loadLegacy()[id] ?? 0;
}

/** Record a bought rank (caller pays the gold). Returns the new rank. */
export function addPerkRank(id: PerkId): number {
  const def = LEGACY_PERKS[id];
  if (!def) return 0;
  const st = loadLegacy();
  st[id] = Math.min((st[id] ?? 0) + 1, def.maxRank);
  save();
  return st[id];
}

/** The perk modifiers, one entry PER RANK — the skill aggregate's base. */
export function legacyBaseModifiers(): SkillModifier[] {
  const st = loadLegacy();
  const out: SkillModifier[] = [];
  for (const id of Object.keys(st)) {
    const def = LEGACY_PERKS[id];
    if (!def) continue;
    for (let i = 0; i < st[id]; i++) out.push(def.modifier);
  }
  return out;
}

/** Does the player own the start-with-a-card perk? */
export function hasStartCardPerk(): boolean {
  return Object.keys(loadLegacy()).some((id) => LEGACY_PERKS[id]?.startCard && (loadLegacy()[id] ?? 0) > 0);
}

/** Test seam. */
export function __resetLegacyCache(): void {
  cached = null;
}
