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

/**
 * Hard ceiling on the stacked move-speed multiplier, applied once in
 * `aggregateSkills`. Today's tree tops out at 1.04³ ≈ 1.125, so this is
 * headroom rather than a nerf — it exists so the NEXT contributor can't
 * quietly multiply past a speed the physics was never tuned for.
 */
export const MOVE_SPEED_MULT_CAP = 1.5;

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

  // ── Momentum-aware smalls ──────────────────────────────────────────────
  // These are the tree's answer to "what game is this?". Both are FARMABLE, so
  // both aggregate ADDITIVELY (DECLONE §1.2) and both are scaled downstream by
  // `momentumT` — worth nothing at a standstill, worth their printed value at
  // terminal speed, concave in between. Nothing here can run away, because
  // momentumT is structurally incapable of exceeding 1.
  /** Extra fraction of cooldown-decay RATE at terminal speed (0.35 = +35%). */
  momentumCooldownRate?: number;
  /** Extra fraction of ability POWER at terminal speed (0.15 = +15%). */
  momentumAbilityPower?: number;

  // ── Keystones ──────────────────────────────────────────────────────────
  // A keystone is a RULE CHANGE plus a STRUCTURAL DRAWBACK (the PoE lesson),
  // never a bigger number. Each of the three is a boolean because there is
  // nothing to scale: you either play by the new rule or you do not.
  /** Casts you cannot afford fire anyway and cost a heart. Drawback: −30 mana. */
  bloodPrice?: boolean;
  /** You burn the floor whenever you are fast. Drawback: your own fire bites. */
  cinderWake?: boolean;
  /** The table is your only battery. Drawback: the clock stops refilling it. */
  dynamo?: boolean;
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
  /**
   * KEYSTONE — BLOOD PRICE. The rule: an empty pool stops being a wall. A cast
   * you cannot afford in mana goes off anyway and takes a heart.
   *
   * The drawback is structural, not a tax: −30 max mana, permanently, which is
   * what GUARANTEES you meet the new rule instead of merely being allowed to.
   * A steel node that reaches into the arcana economy is the point — the
   * survival branch buys you the right to spend survival.
   */
  bloodprice: { id: "bloodprice", label: "Blood Price", icon: "🩸", branch: "steel", row: 3, maxRank: 1, cost: 3, requires: ["juggernaut"], description: "KEYSTONE — cast with an empty pool, paying 1 heart. −30 max mana, forever.", modifier: { bloodPrice: true, manaMaxFlat: -30 } },

  // ── FLIPPER — momentum, mobility, gold ──
  greasedgreaves: { id: "greasedgreaves", label: "Greased Greaves", icon: "👢", branch: "flipper", row: 0, maxRank: 3, cost: 1, description: "+4% move speed per rank", modifier: { moveSpeedMult: 1.04 } },
  ballbearings: { id: "ballbearings", label: "Ball Bearings", icon: "🪩", branch: "flipper", row: 1, maxRank: 2, cost: 1, requires: ["greasedgreaves"], description: "+15% damage while riding momentum, per rank", modifier: { pinballDamageMult: 1.15 } },
  coinmagnet: { id: "coinmagnet", label: "Coin Magnet", icon: "🪙", branch: "flipper", row: 1, maxRank: 2, cost: 1, requires: ["greasedgreaves"], description: "coins worth +10% per rank", modifier: { goldMult: 1.1 } },
  wreckingball: { id: "wreckingball", label: "Wrecking Ball", icon: "💥", branch: "flipper", row: 2, maxRank: 1, cost: 2, requires: ["ballbearings"], description: "+25% damage while riding momentum", modifier: { pinballDamageMult: 1.25 } },
  /** Cooldowns recover on the SPEEDOMETER, not only the clock. Nothing at a
   *  walk, +35%/rank at terminal — the first tree node that pays you for the
   *  thing the game is actually about. */
  overdrive: { id: "overdrive", label: "Overdrive", icon: "⏩", branch: "flipper", row: 3, maxRank: 2, cost: 1, requires: ["ballbearings"], description: "abilities cool down up to +35% faster per rank — scaled by your speed", modifier: { momentumCooldownRate: 0.35 } },
  /**
   * KEYSTONE — CINDER WAKE. The rule: once you are past half the momentum ramp
   * you are ON FIRE, permanently, not only during a Flipper Charge. The horde
   * burns on the line you take.
   *
   * The drawback is the same sentence read backwards: your own fire stops being
   * harmless. The lane you just laid is a lane you can drive back into, and on
   * a maze floor you will. You cannot take the trail without taking the trap.
   */
  cinderwake: { id: "cinderwake", label: "Cinder Wake", icon: "🔥", branch: "flipper", row: 4, maxRank: 1, cost: 3, requires: ["wreckingball"], description: "KEYSTONE — burn the floor whenever you are fast. Your own fire burns YOU.", modifier: { cinderWake: true } },

  // ── ARCANA — mana, cooldowns, ability unlocks ──
  manawell: { id: "manawell", label: "Mana Well", icon: "🔮", branch: "arcana", row: 0, maxRank: 2, cost: 1, description: "+15 max mana per rank", modifier: { manaMaxFlat: 15 } },
  swiftcasting: { id: "swiftcasting", label: "Swift Casting", icon: "⚡", branch: "arcana", row: 1, maxRank: 2, cost: 1, requires: ["manawell"], description: "-10% ability cooldowns per rank", modifier: { cooldownMult: 0.9 } },
  unlockmagnet: { id: "unlockmagnet", label: "Magnet Aura", icon: "🧲", branch: "arcana", row: 1, maxRank: 1, cost: 1, requires: ["manawell"], description: "unlock the Magnet Aura ability", modifier: { unlockAbility: "magnetaura" } },
  unlocktimecrawl: { id: "unlocktimecrawl", label: "Time Crawl", icon: "⏳", branch: "arcana", row: 2, maxRank: 1, cost: 2, requires: ["unlockmagnet"], description: "unlock the Time Crawl ability", modifier: { unlockAbility: "timecrawl" } },
  unlockbladestorm: { id: "unlockbladestorm", label: "Blade Storm", icon: "🌪️", branch: "arcana", row: 2, maxRank: 1, cost: 2, requires: ["swiftcasting"], description: "unlock the Blade Storm ability", modifier: { unlockAbility: "bladestorm" } },
  /**
   * The node ABILITY_FX_PLAN §5 said shipped and never did. Slick Field was
   * handed out free in `state.unlockedAbilities` while the plan described an
   * arcana unlock, so the branch whose stated job is "UNLOCKING the locked
   * active abilities" quietly had a hole in it. There are two Q/E slots and two
   * default abilities: a third free one was not a gift, it was an unowned node.
   */
  unlockslick: { id: "unlockslick", label: "Slick Field", icon: "🛢️", branch: "arcana", row: 1, maxRank: 1, cost: 1, requires: ["manawell"], description: "unlock the Slick Field ability", modifier: { unlockAbility: "slickfield" } },
  /** Your spells hit as hard as you are travelling. Additive with ability ranks
   *  (both are farmable), momentum-scaled so it is worth nothing standing still. */
  kineticfocus: { id: "kineticfocus", label: "Kinetic Focus", icon: "🎯", branch: "arcana", row: 3, maxRank: 2, cost: 1, requires: ["swiftcasting"], description: "+15% ability power per rank — scaled by your speed", modifier: { momentumAbilityPower: 0.15 } },
  /**
   * KEYSTONE — DYNAMO. The rule: mana stops arriving on a wall clock. The TABLE
   * is the battery — every bounce pays 3.2× the normal trickle.
   *
   * The drawback is total and structural: stand still and the pool never comes
   * back, no matter how long you wait. This is the one node that decides what
   * kind of run you are having, because it makes every ability in the game a
   * function of how well you are riding rather than of how long you have lived.
   */
  dynamo: { id: "dynamo", label: "Dynamo", icon: "🔋", branch: "arcana", row: 4, maxRank: 1, cost: 3, requires: ["kineticfocus"], description: "KEYSTONE — bounces pay 3.2× mana. Mana no longer regenerates on its own.", modifier: { dynamo: true } },
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
  /** Additive fraction of extra cooldown-decay rate at terminal speed. */
  momentumCooldownRate: number;
  /** Additive fraction of extra ability power at terminal speed. */
  momentumAbilityPower: number;
  /** Keystone: an unaffordable cast fires and costs a heart. */
  bloodPrice: boolean;
  /** Keystone: burn the floor at speed, and be burnt by it. */
  cinderWake: boolean;
  /** Keystone: the table is the only mana source. */
  dynamo: boolean;
  unlocked: AbilityId[];
}

export function neutralAggregate(): SkillAggregate {
  return { damageMult: 1, moveSpeedMult: 1, maxHpFlat: 0, manaMaxFlat: 0, cooldownMult: 1, goldMult: 1, pinballDamageMult: 1, xpMult: 1, momentumCooldownRate: 0, momentumAbilityPower: 0, bloodPrice: false, cinderWake: false, dynamo: false, unlocked: [] };
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
    // ADDITIVE, deliberately — these are farmable ranks, and DECLONE §1.2 puts
    // farmable bonuses in the additive bucket. They are also multiplied by
    // `momentumT` ≤ 1 downstream, so the stack is bounded twice over.
    if (m.momentumCooldownRate) a.momentumCooldownRate += m.momentumCooldownRate;
    if (m.momentumAbilityPower) a.momentumAbilityPower += m.momentumAbilityPower;
  }
  if (times > 0) {
    // Keystones are latched, not counted: maxRank is 1 and a rule cannot be
    // taken twice. Written as an OR so a legacy base and a tree rank granting
    // the same keystone agree instead of racing.
    if (m.bloodPrice) a.bloodPrice = true;
    if (m.cinderWake) a.cinderWake = true;
    if (m.dynamo) a.dynamo = true;
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
  // ── THE MOBILITY CLAMP ── one clamp, here, at the aggregate.
  //
  // Move speed is the only stat that feeds the physics rather than the damage
  // maths, and this game's whole feel lives in it. The lesson is already
  // written in this repo's history: the booster corner-jam, where a damping
  // guard could never beat a speed FLOOR applied somewhere else in the stack.
  // A per-source clamp has the same hole — three sources each "safely" under
  // the limit still multiply past it.
  //
  // So every mobility contributor (tree ranks, legacy perks, and whatever a
  // later wave adds — boots are the obvious next one) folds in raw, and the
  // ceiling is applied exactly once, on the way out.
  a.moveSpeedMult = Math.min(MOVE_SPEED_MULT_CAP, a.moveSpeedMult);
  return a;
}

/**
 * Why a node can't take another rank. The POINTS gate is deliberately split
 * from the others: affording a node is a property of your wallet that changes
 * on every spend, while being maxed or missing a prerequisite is a property of
 * the node itself. Collapsing the two made the whole tree light up green at
 * 1 point and go dark the instant it was spent — read as "it selects
 * everything, then deselects everything, then nothing is clickable". The menu
 * styles `reachable` (stable) and `ok` (affordable) differently on the back of
 * this distinction.
 */
export type SkillGate = "ok" | "maxed" | "prereq" | "points";

/** Can this node take another rank right now? */
export function canLearn(
  id: SkillId,
  ranks: Record<SkillId, number>,
  points: number,
): { ok: boolean; why?: string; gate: SkillGate; reachable: boolean } {
  const def = SKILLS[id];
  if (!def) return { ok: false, why: "unknown skill", gate: "prereq", reachable: false };
  const cur = ranks[id] ?? 0;
  if (cur >= def.maxRank) return { ok: false, why: "maxed", gate: "maxed", reachable: false };
  for (const req of def.requires ?? []) {
    if ((ranks[req] ?? 0) < 1) {
      return { ok: false, why: `requires ${SKILLS[req]?.label ?? req}`, gate: "prereq", reachable: false };
    }
  }
  // Prereqs are satisfied — this node is REACHABLE regardless of the balance.
  if (points < def.cost) {
    return { ok: false, why: `needs ${def.cost} point${def.cost === 1 ? "" : "s"}`, gate: "points", reachable: true };
  }
  return { ok: true, gate: "ok", reachable: true };
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
