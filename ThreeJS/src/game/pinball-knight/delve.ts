/**
 * ⚗️ DELVE CATCH-UP — arriving deep without arriving helpless.
 *
 * The pool is shared and descending now RALLIES you onto the floor everyone else
 * is on (`net/rally.ts`). That is the whole point, and it creates one problem:
 * character progression is run-scoped (`run/ledger.ts` resets charLevel, skill
 * points and hearts on every new run), so a knight who drops onto floor 12 to
 * join their friends arrives at level 1, six hearts, an un-upgraded sword and no
 * armor — and dies in seconds. The same thing already happened to a solo player
 * walking back to their corpse on floor 12 after a death.
 *
 * So: entering a floor you did not WALK to grants the progression a knight who
 * had walked there would plausibly own by then.
 *
 * WHAT "PLAUSIBLY" MEANS — the numbers are DERIVED, not hand-waved. `floorXpIncome`
 * models a floor's XP as the horde it actually spawns (`levelConfig(f).zombies`)
 * times the fraction of it a player kills on the way through, plus the
 * floor-clear award. Feed that through the real `grantXp` curve and you get the
 * level a walker would be at. When the curve is retuned, this follows it for
 * free — there is no second balance table to keep in sync.
 *
 * WHAT IT GRANTS. Levels + skill points (the player chooses what to spend them
 * on — the boon is not a build), hearts (`bonusMaxHp`, because unspent points
 * keep nobody alive), a depth-appropriate weapon upgrade, and a full set of
 * armor. Never a downgrade: everything is a top-up against what you already
 * have, so calling it again after regrouping to a SHALLOWER floor is a no-op.
 */
import { levelConfig } from "./constants";
import { grantXp, XP_KILL, xpForFloorClear, type XpState } from "./skills";
import { GEAR, GEAR_SLOTS } from "./items";
import { state } from "./state";
import { invalidateSkillAgg } from "./skill-runtime";

/**
 * Fraction of a floor's horde a knight kills on the way through — the ONE
 * estimated input in this file, and therefore the knob to turn if drop-ins land
 * too strong or too weak.
 *
 * Not 1: the floors are sprawling (135-zombie cap, ~50k tiles deep down) and a
 * knight rolling for the stairs leaves most of the maze alive. Not tiny either:
 * skills.test.ts's deliberately conservative "decent run" scenario is 30 kills
 * across three floors, and a player who actually fights is well past that.
 */
const CLEAR_FRACTION = 0.4;
/** Hearts granted per depth step, and the ceiling on them. Hearts are the one
 *  stat a new arrival cannot buy with skill points fast enough to matter. */
const HEARTS_PER_FLOOR = 0.5;
const HEARTS_CAP = 6;
/** Weapon upgrade levels granted per depth step, and their ceiling. Kept below
 *  what a real weaponsmith run reaches — this is a floor, not a shortcut. */
const UPGRADE_PER_FLOOR = 0.5;
const UPGRADE_CAP = 5;

/** XP a floor is worth to someone who actually fought their way through it. */
export function floorXpIncome(floor: number): number {
  const f = Math.max(1, Math.floor(floor));
  return levelConfig(f).zombies * XP_KILL * CLEAR_FRACTION + xpForFloorClear(f, "B");
}

/**
 * The progression a knight who WALKED to `floor` would hold on arrival — i.e.
 * the income of every floor ABOVE it. Floor 1 is the start of a run, so it
 * expects nothing.
 */
export function expectedProgress(floor: number): XpState {
  let s: XpState = { xp: 0, level: 1, points: 0 };
  for (let f = 1; f < Math.max(1, Math.floor(floor)); f++) {
    // Destructured, not spread: grantXp also returns `levelsGained`, and letting
    // that ride along would leak a per-step counter into a cumulative total.
    const { xp, level, points } = grantXp(s, floorXpIncome(f));
    s = { xp, level, points };
  }
  return s;
}

export interface DelveBoon {
  /** Character levels gained by the top-up. */
  levels: number;
  /** Skill points handed over (one per level). */
  points: number;
  /** Extra max hearts. */
  hearts: number;
  /** Weapon upgrade level the active weapon was raised TO (0 = untouched). */
  upgrade: number;
  /** True when a full set of armor was issued. */
  gear: boolean;
}

export interface DelveState {
  level: number;
  xp: number;
  points: number;
  hearts: number;
  upgrade: number;
}

/**
 * Work out the top-up for arriving at `floor` with the progression in `cur`.
 * Pure — every clamp lives here so the balance is testable without a scene.
 *
 * Returns null when nothing is owed: floor 1, or a knight already at or past
 * what the depth expects (someone who genuinely walked down).
 */
export function planCatchUp(floor: number, cur: DelveState): DelveBoon | null {
  const target = Math.max(1, Math.floor(floor));
  if (target <= 1) return null;

  const want = expectedProgress(target);
  const levels = Math.max(0, want.level - cur.level);
  const hearts = Math.max(0, Math.min(HEARTS_CAP, Math.floor((target - 1) * HEARTS_PER_FLOOR)) - cur.hearts);
  const upgradeTo = Math.min(UPGRADE_CAP, Math.floor((target - 1) * UPGRADE_PER_FLOOR));
  const upgrade = upgradeTo > cur.upgrade ? upgradeTo : 0;
  if (levels === 0 && hearts === 0 && upgrade === 0) return null;
  return { levels, points: levels, hearts, upgrade, gear: true };
}

/**
 * Apply the catch-up for a knight arriving on `floor`. Returns what was granted
 * (null when nothing was owed) so the caller can announce it.
 *
 * Called from the descend/regroup path ONLY — never from the between-floor
 * stairs, where the player earned the depth the honest way.
 */
export function applyDelveCatchUp(floor: number): DelveBoon | null {
  const w = state.weaponSlots[state.activeSlot];
  const boon = planCatchUp(floor, {
    level: state.charLevel,
    xp: state.charXp,
    points: state.skillPoints,
    hearts: state.bonusMaxHp,
    upgrade: w?.upgrade ?? 0,
  });
  if (!boon) return null;

  state.charLevel += boon.levels;
  state.skillPoints += boon.points;
  state.charXp = 0; // the top-up lands ON a level boundary, not part-way into one
  state.bonusMaxHp += boon.hearts;
  if (boon.upgrade > 0 && w) w.upgrade = boon.upgrade;
  // A full set, exactly as the tavern's repair-all issues it. Never strips a
  // better piece the player already carries.
  if (boon.gear) {
    for (const s of GEAR_SLOTS) {
      const grant = GEAR[s].absorb > 0 ? GEAR[s].absorb : 1;
      if ((state.gear[s] ?? 0) < grant) state.gear[s] = grant;
    }
  }
  invalidateSkillAgg(); // hearts feed playerMaxHp through the aggregate's consumers
  state.hudDirty = true;
  return boon;
}
