import { describe, it, expect } from "vitest";
import { aggregateCards, CARDS } from "./cards";
import { ENEMY_DROPS } from "./reagents";

/** Regression coverage for the content-expansion wave (CONTENT_EXPANSION_PLAN.md):
 *  the new card fields + set bonuses, and roster-table completeness. */
describe("expansion cards", () => {
  it("aggregates the new fields (material / crit / lifesteal / pierce)", () => {
    expect(aggregateCards(["elementalist"]).materialMult).toBeCloseTo(1.4);
    expect(aggregateCards(["keenmind"]).critChance).toBeCloseTo(0.2);
    expect(aggregateCards(["keenmind"]).critMult).toBe(2); // default when unset
    expect(aggregateCards(["assassin"]).critMult).toBe(2.5);
    expect(aggregateCards(["leech"]).lifesteal).toBe(1);
    expect(aggregateCards(["piercer"]).pierce).toBe(2);
    expect(aggregateCards(["railgun"]).pierce).toBe(5);
  });

  it("crit chance sums and clamps at 1", () => {
    expect(aggregateCards(["deathmark", "bloodpact"]).critChance).toBe(0.9); // 0.4 + 0.5
    // three big crit cards can't exceed certainty
    expect(aggregateCards(["deathmark", "bloodpact", "assassin"]).critChance).toBe(1);
  });

  it("STORM set (2+ bolt cards) resonates for +25% damage", () => {
    const solo = aggregateCards(["thunderlord"]).damageMult; // 1.4
    const set = aggregateCards(["thunderlord", "stormchain"]).damageMult; // 1.4 × 1.25
    expect(set).toBeCloseTo(solo * 1.25);
  });

  it("ASSASSIN set (2+ crit cards) deepens crit multiplier by +0.5", () => {
    // assassin critMult 2.5, keenmind default 2 → max 2.5, +0.5 set bonus = 3.0
    expect(aggregateCards(["assassin", "keenmind"]).critMult).toBeCloseTo(3.0);
  });

  it("ATTUNED set (2+ marble cards) amplifies material synergy ×1.3", () => {
    const two = aggregateCards(["elementalist", "overcharged"]).materialMult;
    expect(two).toBeCloseTo(1.4 * 1.85 * 1.3);
  });

  it("cursed cards carry a real drawback (durability < 1)", () => {
    expect(CARDS.gladeath.modifier.durabilityMult!).toBeLessThan(1);
    expect(CARDS.gladeath.modifier.damageMult!).toBeGreaterThan(2);
    expect(CARDS.bloodpact.modifier.durabilityMult!).toBeLessThan(1);
  });
});

describe("expansion roster", () => {
  const NEW_KINDS = ["hound", "bloater", "necromancer", "warden", "wisp", "sapper", "crystalback", "mimic"] as const;

  it("every new kind has a reagent drop entry", () => {
    for (const k of NEW_KINDS) {
      expect(ENEMY_DROPS[k], `${k} missing drops`).toBeDefined();
      expect(ENEMY_DROPS[k].length).toBeGreaterThan(0);
    }
  });
});
