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
import { PLAYER_MAX_HP, MANA_MAX } from "./constants";
import { SKILLS, aggregateSkills, canLearn, grantXp, xpForFloorClear, XP_KILL, XP_KILL_BOSS, type SkillAggregate, type SkillId } from "./skills";
import { legacyBaseModifiers } from "./legacy";
import type { AbilityId } from "./abilities";

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

/** Max mana with Mana Well ranks. */
export function playerManaMax(): number {
  return MANA_MAX + skillAgg().manaMaxFlat;
}

/** Abilities usable in the Q/E slots: the two defaults + tree unlocks. */
export function unlockedAbilities(): AbilityId[] {
  return [...state.unlockedAbilities, ...skillAgg().unlocked.filter((a) => !state.unlockedAbilities.includes(a))];
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
