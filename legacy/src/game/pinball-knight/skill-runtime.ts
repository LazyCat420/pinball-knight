/**
 * SKILL RUNTIME — the live glue between the pure tree (skills.ts) and the
 * game: a memoized aggregate every hot path reads, XP awards, point spending,
 * and the derived max-HP/max-mana the HUD and potions use.
 *
 * The aggregate is recomputed only when a rank is spent or a run resets —
 * playerDamage and the movement code read it every hit/frame, and rebuilding
 * a Record fold there would be waste.
 */
import { state } from "./state";
import { PLAYER_MAX_HP, MANA_MAX, MANA_POOL_FLOOR, ABILITY_RANK_MAX } from "./constants";
import { SKILLS, aggregateSkills, canLearn, grantXp, xpForFloorClear, XP_KILL, XP_KILL_BOSS, type SkillAggregate, type SkillId } from "./skills";
import { legacyBaseModifiers } from "./legacy";
import { abilityRank, abilityRankCost, type AbilityId } from "./abilities";

let cached: SkillAggregate | null = null;

/** The combined skill + legacy effects. Cheap: memoized until invalidated. */
export function skillAgg(): SkillAggregate {
  if (!cached) cached = aggregateSkills(state.skillRanks, legacyBaseModifiers());
  return cached;
}

/** Call after anything that changes ranks or perks (spend, reset, purchase). */
export function invalidateSkillAgg(): void {
  cached = null;
}

/** Max hearts with Iron Heart ranks + legacy scars + any Elixir of Life bump
 * brewed this run (state.bonusMaxHp; see items.ts / applyPotion). */
export function playerMaxHp(): number {
  return PLAYER_MAX_HP + skillAgg().maxHpFlat + state.bonusMaxHp;
}

/**
 * Max mana with Mana Well ranks — and with the Blood Price keystone's −30,
 * which is the first NEGATIVE contributor this pool has ever had.
 *
 * Floored above the most expensive ability in the table. A pool that could not
 * afford any cast would not be a hard build, it would be a build in which the
 * mana bar is decoration and Blood Price is not a choice — and a keystone whose
 * drawback deletes the system it modifies is a bug wearing a design hat.
 */
export function playerManaMax(): number {
  return Math.max(MANA_POOL_FLOOR, MANA_MAX + skillAgg().manaMaxFlat);
}

/**
 * Abilities usable in the Q/E slots: the two defaults plus the skill tree's
 * unlocks. THE ONE FUNNEL for "what can I cast".
 *
 * Cards deliberately do NOT feed this. The skill tree upgrades the PLAYER;
 * cards upgrade the GEAR. An earlier cut let a socketed card grant an ability,
 * which blurred the only line that makes two progression systems worth having.
 */
export function unlockedAbilities(): AbilityId[] {
  const out = [...state.unlockedAbilities];
  for (const a of skillAgg().unlocked) if (!out.includes(a)) out.push(a);
  return out;
}

/**
 * Drop any Q/E binding whose ability is no longer available, and clear its live
 * cooldown.
 *
 * Called after ANYTHING that can change the held weapon — swap, pickup, a weapon
 * breaking at 0 durability. Without it a card-granted ability stays bound to Q
 * after the weapon carrying it leaves your hand, and casting it would be free
 * power from a weapon you are not holding.
 *
 * Returns true if a slot actually changed, so the caller can flag the HUD dirty.
 */
export function syncAbilitySlots(): boolean {
  const ok = unlockedAbilities();
  let changed = false;
  for (const slot of [0, 1] as const) {
    const id = state.abilitySlots[slot];
    if (id && !ok.includes(id)) {
      state.abilitySlots[slot] = null;
      delete state.abilityCd[id];
      changed = true;
    }
  }
  return changed;
}

/** Level-up fanfare is core's business (toast + sting); wired at launch. */
let onLevelUp: ((level: number, points: number) => void) | null = null;
export function setLevelUpHandler(fn: ((level: number, points: number) => void) | null): void {
  onLevelUp = fn;
}

function award(amount: number): void {
  const scaled = amount * skillAgg().xpMult;
  const next = grantXp({ xp: state.charXp, level: state.charLevel, points: state.skillPoints }, scaled);
  state.charXp = next.xp;
  state.charLevel = next.level;
  state.skillPoints = next.points;
  if (next.levelsGained > 0) {
    const p = state.player;
    if (p) state.vfx?.sparks(p.x, 1.2, p.z, 0, 0, 14);
    onLevelUp?.(next.level, next.points);
  }
  state.hudDirty = true;
}

/** XP for a kill — called from combat's killZombie, the single kill funnel. */
export function awardKillXp(boss: boolean): void {
  award(boss ? XP_KILL_BOSS : XP_KILL);
}

/** Debug-panel XP grant — same pipeline, no pretence of a source. */
export function awardDebugXp(amount: number): void {
  award(amount);
}

/** XP for clearing a floor, scaled by its grade — called from descend(). */
export function awardFloorXp(floor: number, grade: string): void {
  award(xpForFloorClear(floor, grade));
}

/**
 * Spend points into an ABILITY instead of a tree node — the same wallet, so
 * every rank bought here is a tree rank not bought.
 *
 * Gated on the ability being UNLOCKED, deliberately: ranks are an investment in
 * something you can actually cast, and letting a player sink six points into a
 * spell they have no node for would be a trap with no feedback. The escalating
 * price (1, 2, 3) is what stops "dump everything into Arcane Pulse" from being
 * strictly correct.
 */
export function spendAbilityRank(id: AbilityId): { ok: boolean; why?: string } {
  if (!unlockedAbilities().includes(id)) return { ok: false, why: "ability not unlocked" };
  const rank = abilityRank(id);
  if (rank >= ABILITY_RANK_MAX) return { ok: false, why: "maxed" };
  const cost = abilityRankCost(rank);
  if (state.skillPoints < cost) return { ok: false, why: `needs ${cost} point${cost === 1 ? "" : "s"}` };
  state.abilityRanks[id] = rank + 1;
  state.skillPoints -= cost;
  state.hudDirty = true;
  return { ok: true };
}

/** Spend one point into a node. Returns ok/why for the menu to flash. */
export function spendSkillPoint(id: SkillId): { ok: boolean; why?: string } {
  const check = canLearn(id, state.skillRanks, state.skillPoints);
  if (!check.ok) return check;
  const def = SKILLS[id];
  state.skillRanks[id] = (state.skillRanks[id] ?? 0) + 1;
  state.skillPoints -= def.cost;
  invalidateSkillAgg();
  // An unlock is only useful if the player can equip it — surface immediately.
  const unlock = def.modifier.unlockAbility;
  if (unlock && !state.unlockedAbilities.includes(unlock)) state.unlockedAbilities.push(unlock);
  state.hudDirty = true;
  return { ok: true };
}
