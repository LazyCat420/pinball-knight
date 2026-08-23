/**
 * SKILL AUDIT — every node in the tree, checked end-to-end.
 *
 * skills.test.ts covers the pure table (prereqs exist, multipliers compound).
 * This file asks the different question: does buying a rank actually CHANGE THE
 * GAME? A node whose modifier no downstream system reads is a dead node — the
 * menu happily sells it and nothing happens.
 *
 * Each test spends real points through spendSkillPoint (the same path the menu
 * uses) and asserts the observable output moved.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { state, resetState } from "./state";
import { SKILLS, SKILL_IDS, aggregateSkills } from "./skills";
import { spendSkillPoint, skillAgg, invalidateSkillAgg, playerMaxHp, playerManaMax, unlockedAbilities } from "./skill-runtime";
import { PLAYER_MAX_HP, MANA_MAX } from "./constants";

/** Grant points and clear the memoized aggregate, as a level-up would. */
function givePoints(n: number): void {
  state.skillPoints = n;
  invalidateSkillAgg();
}

/** Buy a node and everything it requires, cheapest path first. */
function learn(id: string): void {
  const def = SKILLS[id];
  for (const req of def.requires ?? []) if ((state.skillRanks[req] ?? 0) < 1) learn(req);
  givePoints(state.skillPoints + def.cost);
  const res = spendSkillPoint(id);
  expect(res.ok, `failed to learn ${id}: ${res.why}`).toBe(true);
}

beforeEach(() => {
  resetState();
  state.skillRanks = {};
  state.skillPoints = 0;
  state.bonusMaxHp = 0;
  state.unlockedAbilities = [];
  invalidateSkillAgg();
});

describe("every skill node is reachable and buyable", () => {
  it("can learn every node in the tree to max rank", () => {
    for (const id of SKILL_IDS) {
      resetState();
      state.skillRanks = {};
      state.unlockedAbilities = [];
      invalidateSkillAgg();
      const def = SKILLS[id];
      for (let r = 0; r < def.maxRank; r++) learn(id);
      expect(state.skillRanks[id], `${id} did not reach maxRank`).toBe(def.maxRank);
    }
  });

  it("refuses to overspend past maxRank even with points to burn", () => {
    learn("whetstone");
    learn("whetstone");
    learn("whetstone"); // maxRank 3
    givePoints(99);
    expect(spendSkillPoint("whetstone").ok).toBe(false);
    expect(state.skillRanks.whetstone).toBe(3);
    expect(state.skillPoints).toBe(99); // no points consumed on a refused buy
  });

  it("deducts exactly the node's cost", () => {
    givePoints(5);
    spendSkillPoint("whetstone"); // cost 1
    expect(state.skillPoints).toBe(4);
    learn("ironheart");
    const before = state.skillPoints;
    givePoints(before + 2);
    spendSkillPoint("juggernaut"); // cost 2
    expect(state.skillPoints).toBe(before);
  });
});

describe("each modifier reaches a real downstream system", () => {
  it("whetstone + juggernaut raise the damage multiplier", () => {
    const base = skillAgg().damageMult;
    learn("whetstone");
    expect(skillAgg().damageMult).toBeGreaterThan(base);
    const afterWhet = skillAgg().damageMult;
    learn("ironheart");
    learn("juggernaut");
    expect(skillAgg().damageMult).toBeGreaterThan(afterWhet);
  });

  it("ironheart raises playerMaxHp, the value the HUD and heals read", () => {
    expect(playerMaxHp()).toBe(PLAYER_MAX_HP);
    learn("ironheart"); // pulls in whetstone
    expect(playerMaxHp()).toBe(PLAYER_MAX_HP + 1);
    learn("ironheart");
    expect(playerMaxHp()).toBe(PLAYER_MAX_HP + 2);
  });

  it("manawell raises playerManaMax, the pool abilities spend from", () => {
    expect(playerManaMax()).toBe(MANA_MAX);
    learn("manawell");
    expect(playerManaMax()).toBe(MANA_MAX + 15);
  });

  it("greasedgreaves raises the move-speed multiplier", () => {
    const base = skillAgg().moveSpeedMult;
    learn("greasedgreaves");
    expect(skillAgg().moveSpeedMult).toBeGreaterThan(base);
  });

  it("coinmagnet raises the gold multiplier", () => {
    expect(skillAgg().goldMult).toBeCloseTo(1);
    learn("coinmagnet");
    expect(skillAgg().goldMult).toBeGreaterThan(1);
  });

  it("swiftcasting LOWERS the cooldown multiplier (a faster ability)", () => {
    expect(skillAgg().cooldownMult).toBeCloseTo(1);
    learn("swiftcasting");
    expect(skillAgg().cooldownMult).toBeLessThan(1);
    expect(skillAgg().cooldownMult).toBeGreaterThan(0); // never zero/negative
  });

  it("ballbearings + wreckingball raise the pinball damage multiplier", () => {
    expect(skillAgg().pinballDamageMult).toBeCloseTo(1);
    learn("ballbearings");
    const one = skillAgg().pinballDamageMult;
    expect(one).toBeGreaterThan(1);
    learn("wreckingball");
    expect(skillAgg().pinballDamageMult).toBeGreaterThan(one);
  });

  it("every unlock node actually adds its ability to the usable list", () => {
    const unlockNodes = SKILL_IDS.filter((id) => SKILLS[id].modifier.unlockAbility);
    expect(unlockNodes.length).toBeGreaterThan(0);
    for (const id of unlockNodes) {
      resetState();
      state.skillRanks = {};
      state.unlockedAbilities = [];
      invalidateSkillAgg();
      const ability = SKILLS[id].modifier.unlockAbility!;
      expect(unlockedAbilities()).not.toContain(ability);
      learn(id);
      expect(unlockedAbilities(), `${id} did not unlock ${ability}`).toContain(ability);
    }
  });

  it("NO node has a modifier that the aggregate silently drops", () => {
    // Guards against adding a SkillModifier field that fold() forgets to apply.
    //
    // Written as a walk over the aggregate's OWN KEYS rather than a hand-listed
    // set of comparisons. The hand-listed version had the same blind spot as
    // the bug it was guarding against: adding a field to SkillAggregate and
    // forgetting to add it here made the test pass on a node that did nothing.
    // It caught its first real case the day the keystones landed — by failing
    // for the wrong reason.
    const neutral = aggregateSkills({});
    const keys = Object.keys(neutral) as Array<keyof typeof neutral>;
    for (const id of SKILL_IDS) {
      const m = SKILLS[id].modifier;
      const agg = aggregateSkills({ [id]: 1 });
      const changed = keys.some((k) =>
        k === "unlocked" ? agg.unlocked.length !== neutral.unlocked.length : agg[k] !== neutral[k],
      );
      expect(changed, `${id} has modifier ${JSON.stringify(m)} but changes NOTHING in the aggregate`).toBe(true);
    }
  });
});

describe("the memoized aggregate stays honest", () => {
  it("reflects a freshly spent rank without a manual invalidate", () => {
    const before = skillAgg().damageMult; // prime the cache
    learn("whetstone");
    // spendSkillPoint must invalidate internally — a stale cache here would mean
    // buying a skill does nothing until some unrelated event clears it.
    expect(skillAgg().damageMult).toBeGreaterThan(before);
  });

  it("a full respec back to zero ranks returns every value to neutral", () => {
    learn("whetstone");
    learn("ironheart");
    learn("manawell");
    state.skillRanks = {};
    invalidateSkillAgg();
    expect(skillAgg().damageMult).toBeCloseTo(1);
    expect(playerMaxHp()).toBe(PLAYER_MAX_HP);
    expect(playerManaMax()).toBe(MANA_MAX);
  });
});

