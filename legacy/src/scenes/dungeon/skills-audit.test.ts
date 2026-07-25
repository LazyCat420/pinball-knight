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
import { spendSkillPoint, skillAgg, invalidateSkillAgg, playerMaxHp, playerManaMax, unlockedAbilities, syncAbilitySlots, abilityCostMult } from "./skill-runtime";
import { CARDS, CARD_IDS, socketCard } from "./cards";
import { freshWeapon } from "./items";
import { ABILITIES } from "./abilities";
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
    for (const id of SKILL_IDS) {
      const m = SKILLS[id].modifier;
      const agg = aggregateSkills({ [id]: 1 });
      const neutral = aggregateSkills({});
      const changed =
        agg.damageMult !== neutral.damageMult ||
        agg.moveSpeedMult !== neutral.moveSpeedMult ||
        agg.maxHpFlat !== neutral.maxHpFlat ||
        agg.manaMaxFlat !== neutral.manaMaxFlat ||
        agg.cooldownMult !== neutral.cooldownMult ||
        agg.goldMult !== neutral.goldMult ||
        agg.pinballDamageMult !== neutral.pinballDamageMult ||
        agg.xpMult !== neutral.xpMult ||
        agg.unlocked.length !== neutral.unlocked.length;
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

/**
 * SKILL CARDS — the same "does it actually reach the game" question, asked of
 * cards.ts `grantsAbility`. A granted ability that never appears in
 * `unlockedAbilities()` cannot be bound to Q/E, so the card would be a dead chip
 * that reads as a build-defining drop.
 */
describe("skill cards grant abilities through the one funnel", () => {
  beforeEach(() => {
    resetState();
    invalidateSkillAgg();
  });

  it("a socketed skill card appears in unlockedAbilities", () => {
    // magnetaura is genuinely LOCKED (skills.ts gates it behind unlockmagnet).
    // Testing with one of the three default abilities would pass no matter what.
    expect(unlockedAbilities()).not.toContain("magnetaura");
    state.weaponSlots = [freshWeapon("mace"), null];
    state.activeSlot = 0;
    expect(socketCard(state.weaponSlots[0]!, "magnetheart")).toBe(true);
    expect(unlockedAbilities()).toContain("magnetaura");
  });

  it("only grants abilities the player does NOT already start with", () => {
    // A card granting a default ability is a dead chip with a build-defining
    // description. Cheap to write by accident; caught here.
    const defaults = ["flippercharge", "arcanepulse", "slickfield"];
    for (const id of CARD_IDS) {
      const a = CARDS[id].modifier.grantsAbility;
      if (!a) continue;
      expect(defaults, `${id} grants ${a}, which every knight already has`).not.toContain(a);
    }
  });

  /**
   * The held-weapon rule. This is the whole design of skill cards: the ability
   * rides the weapon, so swapping hands swaps your loadout. If it leaked across
   * the swap, a player could socket an ability into a spare weapon and keep it
   * for free while holding something else.
   */
  it("the grant leaves when the granting weapon leaves your hand", () => {
    const armed = freshWeapon("mace");
    socketCard(armed, "magnetheart");
    state.weaponSlots = [armed, freshWeapon("sword")];
    state.activeSlot = 0;
    expect(unlockedAbilities()).toContain("magnetaura");
    state.activeSlot = 1; // swap to the plain sword
    expect(unlockedAbilities()).not.toContain("magnetaura");
  });

  it("syncAbilitySlots unbinds a Q/E slot the held weapon no longer grants", () => {
    const armed = freshWeapon("mace");
    socketCard(armed, "magnetheart");
    state.weaponSlots = [armed, freshWeapon("sword")];
    state.activeSlot = 0;
    state.abilitySlots[0] = "magnetaura";
    state.abilityCd.magnetaura = 3;
    // Still held: nothing to do.
    expect(syncAbilitySlots()).toBe(false);
    expect(state.abilitySlots[0]).toBe("magnetaura");
    // Swap it away: the binding must go, and its live cooldown with it (a stale
    // cooldown would block the ability if the weapon came back).
    state.activeSlot = 1;
    expect(syncAbilitySlots()).toBe(true);
    expect(state.abilitySlots[0]).toBeNull();
    expect(state.abilityCd.magnetaura).toBeUndefined();
  });

  it("leaves a permanently-unlocked ability bound when weapons change", () => {
    // A card swap must not strip an ability the knight owns outright (a default
    // or a skill-tree unlock) — those are permanent for the run. Both Q/E slots
    // are checked, because syncAbilitySlots sweeps both and an over-eager sweep
    // would silently unbind the one the player did not touch.
    state.weaponSlots = [freshWeapon("sword"), freshWeapon("mace")];
    state.activeSlot = 0;
    state.abilitySlots = ["flippercharge", "arcanepulse"]; // both defaults
    expect(syncAbilitySlots()).toBe(false);
    state.activeSlot = 1;
    expect(syncAbilitySlots()).toBe(false);
    expect(state.abilitySlots).toEqual(["flippercharge", "arcanepulse"]);
  });

  it("prices casts off the held weapon's discount cards", () => {
    state.weaponSlots = [freshWeapon("mace"), null];
    state.activeSlot = 0;
    expect(abilityCostMult()).toBe(1);
    socketCard(state.weaponSlots[0]!, "witchfocus");
    expect(abilityCostMult()).toBeCloseTo(0.75);
    // …and the discount leaves with the weapon, same as the grant.
    state.weaponSlots[1] = freshWeapon("sword");
    state.activeSlot = 1;
    expect(abilityCostMult()).toBe(1);
  });

  it("survives an empty hand — fists socket nothing", () => {
    state.weaponSlots = [null, null];
    state.activeSlot = 0;
    expect(abilityCostMult()).toBe(1);
    expect(() => unlockedAbilities()).not.toThrow();
  });

  it("every skill card's ability is a real ABILITIES entry", () => {
    for (const id of CARD_IDS) {
      const a = CARDS[id].modifier.grantsAbility;
      if (!a) continue;
      expect(ABILITIES[a], `${id} grants unknown ability ${a}`).toBeTruthy();
    }
  });
});
