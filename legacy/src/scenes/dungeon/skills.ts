/**
 * SKILLS — the in-run skill tree. Pure and DOM-free, mirror-image of cards.ts:
 * a data table of nodes, one aggregation function, and the XP curve. The menu
 * draws it; skill-runtime.ts owns the live glue (memoized aggregate, XP awards).
 *
 * SHAPE OF PROGRESSION (hybrid, per the 2026-07-20 plan):
 *  - XP and skill points are earned and spent WITHIN a run and reset on death,
 *    like weapons/gear/cards — the roguelite loop stays honest.
 *  - A small permanent "Legacy" layer (legacy.ts) buys tiny lifetime perks
 *    with banked wallet gold; those enter the same aggregate as a BASE, so
 *    every effect flows through one pipeline.
 *
 * Three branches, three columns in the menu:
 *   steel   — melee damage and survival
 *   flipper — pinball momentum, mobility, gold
 *   arcana  — mana, cooldowns, and UNLOCKING the locked active abilities
 */
import type { AbilityId } from "./abilities";

export type SkillId = string;
export type SkillBranch = "steel" | "flipper" | "arcana";

/** What one RANK of a node does. Multipliers compound across ranks and nodes. */
export interface SkillModifier {
  damageMult?: number;
  moveSpeedMult?: number;
  maxHpFlat?: number;
  manaMaxFlat?: number;
  /** Ability cooldown multiplier (<1 = faster). */
  cooldownMult?: number;
  /** Coin value multiplier. */
  goldMult?: number;
  /** Bonus damage multiplier while riding pinball momentum. */
  pinballDamageMult?: number;
  /** XP gain multiplier (legacy perks only today). */
  xpMult?: number;
  /** Unlocks an active ability for the Q/E slots (rank 1 only). */
  unlockAbility?: AbilityId;
}

export interface SkillNodeDef {
  id: SkillId;
  label: string;
  icon: string;
  description: string;
  branch: SkillBranch;
  /** Row within the branch column (0 = top). */
  row: number;
  maxRank: number;
  /** Skill points per rank. */
  cost: number;
  /** ALL prerequisites need rank ≥ 1. */
  requires?: SkillId[];
  modifier: SkillModifier;
}

export const SKILLS: Record<SkillId, SkillNodeDef> = {
  // ── STEEL — melee & survival ──
  whetstone: { id: "whetstone", label: "Whetstone", icon: "🗡️", branch: "steel", row: 0, maxRank: 3, cost: 1, description: "+6% damage per rank", modifier: { damageMult: 1.06 } },
  ironheart: { id: "ironheart", label: "Iron Heart", icon: "❤️", branch: "steel", row: 1, maxRank: 2, cost: 1, requires: ["whetstone"], description: "+1 max heart per rank", modifier: { maxHpFlat: 1 } },
  juggernaut: { id: "juggernaut", label: "Juggernaut", icon: "🛡️", branch: "steel", row: 2, maxRank: 2, cost: 2, requires: ["ironheart"], description: "+10% damage per rank", modifier: { damageMult: 1.1 } },

  // ── FLIPPER — momentum, mobility, gold ──
  greasedgreaves: { id: "greasedgreaves", label: "Greased Greaves", icon: "👢", branch: "flipper", row: 0, maxRank: 3, cost: 1, description: "+4% move speed per rank", modifier: { moveSpeedMult: 1.04 } },
  ballbearings: { id: "ballbearings", label: "Ball Bearings", icon: "🪩", branch: "flipper", row: 1, maxRank: 2, cost: 1, requires: ["greasedgreaves"], description: "+15% damage while riding momentum, per rank", modifier: { pinballDamageMult: 1.15 } },
  coinmagnet: { id: "coinmagnet", label: "Coin Magnet", icon: "🪙", branch: "flipper", row: 1, maxRank: 2, cost: 1, requires: ["greasedgreaves"], description: "coins worth +10% per rank", modifier: { goldMult: 1.1 } },
  wreckingball: { id: "wreckingball", label: "Wrecking Ball", icon: "💥", branch: "flipper", row: 2, maxRank: 1, cost: 2, requires: ["ballbearings"], description: "+25% damage while riding momentum", modifier: { pinballDamageMult: 1.25 } },

  // ── ARCANA — mana, cooldowns, ability unlocks ──
  manawell: { id: "manawell", label: "Mana Well", icon: "🔮", branch: "arcana", row: 0, maxRank: 2, cost: 1, description: "+15 max mana per rank", modifier: { manaMaxFlat: 15 } },
  swiftcasting: { id: "swiftcasting", label: "Swift Casting", icon: "⚡", branch: "arcana", row: 1, maxRank: 2, cost: 1, requires: ["manawell"], description: "-10% ability cooldowns per rank", modifier: { cooldownMult: 0.9 } },
  unlockmagnet: { id: "unlockmagnet", label: "Magnet Aura", icon: "🧲", branch: "arcana", row: 1, maxRank: 1, cost: 1, requires: ["manawell"], description: "unlock the Magnet Aura ability", modifier: { unlockAbility: "magnetaura" } },
  unlocktimecrawl: { id: "unlocktimecrawl", label: "Time Crawl", icon: "⏳", branch: "arcana", row: 2, maxRank: 1, cost: 2, requires: ["unlockmagnet"], description: "unlock the Time Crawl ability", modifier: { unlockAbility: "timecrawl" } },
  unlockbladestorm: { id: "unlockbladestorm", label: "Blade Storm", icon: "🌪️", branch: "arcana", row: 2, maxRank: 1, cost: 2, requires: ["swiftcasting"], description: "unlock the Blade Storm ability", modifier: { unlockAbility: "bladestorm" } },
  unlockslick: { id: "unlockslick", label: "Slick Field", icon: "🛢️", branch: "arcana", row: 2, maxRank: 1, cost: 2, requires: ["unlockmagnet"], description: "unlock the Slick Field ability", modifier: { unlockAbility: "slickfield" } },
};

export const SKILL_IDS: SkillId[] = Object.keys(SKILLS);
export const SKILL_BRANCHES: SkillBranch[] = ["steel", "flipper", "arcana"];

/** The combined effect of every rank taken (plus an optional legacy base). */
export interface SkillAggregate {
  damageMult: number;
  moveSpeedMult: number;
  maxHpFlat: number;
  manaMaxFlat: number;
  cooldownMult: number;
  goldMult: number;
  pinballDamageMult: number;
  xpMult: number;
  unlocked: AbilityId[];
}

export function neutralAggregate(): SkillAggregate {
  return { damageMult: 1, moveSpeedMult: 1, maxHpFlat: 0, manaMaxFlat: 0, cooldownMult: 1, goldMult: 1, pinballDamageMult: 1, xpMult: 1, unlocked: [] };
}

/** Fold one modifier into an aggregate `times` ranks over. */
function fold(a: SkillAggregate, m: SkillModifier, times: number): void {
  for (let i = 0; i < times; i++) {
    if (m.damageMult) a.damageMult *= m.damageMult;
    if (m.moveSpeedMult) a.moveSpeedMult *= m.moveSpeedMult;
    if (m.maxHpFlat) a.maxHpFlat += m.maxHpFlat;
    if (m.manaMaxFlat) a.manaMaxFlat += m.manaMaxFlat;
    if (m.cooldownMult) a.cooldownMult *= m.cooldownMult;
    if (m.goldMult) a.goldMult *= m.goldMult;
    if (m.pinballDamageMult) a.pinballDamageMult *= m.pinballDamageMult;
    if (m.xpMult) a.xpMult *= m.xpMult;
  }
  if (m.unlockAbility && times > 0 && !a.unlocked.includes(m.unlockAbility)) a.unlocked.push(m.unlockAbility);
}

/**
 * Order-independent aggregation of the taken ranks, layered ON TOP of an
 * optional base (the legacy perks) — one pipeline for both sources.
 */
export function aggregateSkills(ranks: Record<SkillId, number>, base?: SkillModifier[]): SkillAggregate {
  const a = neutralAggregate();
  for (const m of base ?? []) fold(a, m, 1);
  for (const id of Object.keys(ranks)) {
    const def = SKILLS[id];
    const r = ranks[id];
    if (!def || !r || r <= 0) continue;
    fold(a, def.modifier, Math.min(r, def.maxRank));
  }
  return a;
}

/** Can this node take another rank right now? */
export function canLearn(id: SkillId, ranks: Record<SkillId, number>, points: number): { ok: boolean; why?: string } {
  const def = SKILLS[id];
  if (!def) return { ok: false, why: "unknown skill" };
  const cur = ranks[id] ?? 0;
  if (cur >= def.maxRank) return { ok: false, why: "maxed" };
  for (const req of def.requires ?? []) {
    if ((ranks[req] ?? 0) < 1) return { ok: false, why: `requires ${SKILLS[req]?.label ?? req}` };
  }
  if (points < def.cost) return { ok: false, why: `needs ${def.cost} point${def.cost === 1 ? "" : "s"}` };
  return { ok: true };
}

// ── XP curve ──────────────────────────────────────────────────────────────────

/** XP needed to climb FROM `level` to the next. Steep-early: floors 1-3 of a
 * decent run hand out ~3 points, so the tree matters from the first tavern.
 * (Pinned by skills.test.ts — retune the test scenario if you retune this.) */
export function xpForLevel(level: number): number {
  return Math.round(40 * Math.pow(Math.max(1, level), 1.3));
}

export const XP_KILL = 5;
export const XP_KILL_BOSS = 60;

/** Floor-clear award, scaled by the grade the run just earned. */
export function xpForFloorClear(floor: number, grade: string): number {
  const gradeBonus: Record<string, number> = { S: 40, A: 25, B: 10 };
  return 25 + floor * 10 + (gradeBonus[grade] ?? 0);
}

export interface XpState {
  xp: number;
  level: number;
  points: number;
}

/** Apply an XP award, cascading level-ups. Returns the new state + how many
 * levels were gained (each level = +1 skill point). Pure. */
export function grantXp(cur: XpState, amount: number): XpState & { levelsGained: number } {
  let { xp, level, points } = cur;
  xp += Math.max(0, Math.round(amount));
  let gained = 0;
  while (xp >= xpForLevel(level)) {
    xp -= xpForLevel(level);
    level++;
    points++;
    gained++;
  }
  return { xp, level, points, levelsGained: gained };
}
