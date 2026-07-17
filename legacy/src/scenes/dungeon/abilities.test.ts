import { describe, it, expect, beforeEach } from "vitest";
import { ABILITIES, ABILITY_IDS, canCast, tickAbilities, getMana } from "./abilities";
import { state } from "./state";
import { MANA_MAX, MANA_REGEN } from "./constants";

/**
 * The active-skill mana economy is pure logic (no WebGL / audio on these paths),
 * so we can exercise it directly. castAbility itself pokes audio, so it's driven
 * only through canCast + tickAbilities here.
 */

function stubPlayer(mana: number): void {
  // Only the numeric fields the ability upkeep reads — cast through unknown.
  state.player = { mana, magnetAuraT: 0, bladeStormT: 0, bladeStormTickT: 0 } as unknown as typeof state.player;
  state.groundItems = [];
  state.abilityCd = {} as Record<(typeof ABILITY_IDS)[number], number>;
  state.abilitySlots = ["flippercharge", "arcanepulse"];
  state.slowT = 0;
}

describe("ability table integrity", () => {
  it("has exactly the five ids, all coherent and affordable within the pool", () => {
    expect(ABILITY_IDS).toHaveLength(5);
    for (const id of ABILITY_IDS) {
      const def = ABILITIES[id];
      expect(def.id).toBe(id);
      expect(def.cost).toBeGreaterThan(0);
      expect(def.cost).toBeLessThanOrEqual(MANA_MAX); // never unaffordable on a full pool
      expect(def.cooldown).toBeGreaterThan(0);
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.icon.length).toBeGreaterThan(0);
    }
  });
});

describe("mana regen + cooldowns (tickAbilities)", () => {
  beforeEach(() => stubPlayer(0));

  it("regenerates mana toward the cap and clamps there", () => {
    tickAbilities(1);
    expect(getMana()).toBeCloseTo(MANA_REGEN, 5);
    tickAbilities(1000); // way past full
    expect(getMana()).toBe(MANA_MAX);
  });

  it("decays ability cooldowns to zero, never below", () => {
    state.abilityCd.flippercharge = 2;
    tickAbilities(0.5);
    expect(state.abilityCd.flippercharge).toBeCloseTo(1.5, 5);
    tickAbilities(5);
    expect(state.abilityCd.flippercharge).toBe(0);
  });

  it("counts Time Crawl down and stops at zero", () => {
    state.slowT = 1;
    tickAbilities(0.4);
    expect(state.slowT).toBeCloseTo(0.6, 5);
    tickAbilities(5);
    expect(state.slowT).toBe(0);
  });
});

describe("canCast gating", () => {
  it("allows a cast only when equipped, off cooldown, and affordable", () => {
    stubPlayer(MANA_MAX);
    expect(canCast(0)).toBe(true); // flippercharge, full pool, no cd

    // on cooldown → blocked
    state.abilityCd.flippercharge = 1;
    expect(canCast(0)).toBe(false);
    state.abilityCd.flippercharge = 0;
    expect(canCast(0)).toBe(true);

    // too little mana → blocked (arcanepulse costs 35)
    stubPlayer(10);
    expect(canCast(1)).toBe(false);

    // empty slot → blocked
    stubPlayer(MANA_MAX);
    state.abilitySlots = [null, null];
    expect(canCast(0)).toBe(false);
  });
});
