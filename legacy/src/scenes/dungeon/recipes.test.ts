/**
 * Pure tests for the alchemy recipe book — the affordability check and the
 * cost breakdown the Tavern applies on a confirmed brew. UI (the brew panel) is
 * not tested; this covers the arithmetic a full belt / empty pouch depends on.
 */
import { describe, it, expect } from "vitest";
import { RECIPES, RECIPE_IDS, canCraft, craftCost, type Pouch } from "./recipes";
import { REAGENTS } from "./reagents";
import { POTIONS } from "./items";

describe("recipe table", () => {
  it("every recipe id round-trips and points at real reagents + a real output", () => {
    for (const id of RECIPE_IDS) {
      const r = RECIPES[id];
      expect(r.id).toBe(id);
      for (const rid of Object.keys(r.inputs)) expect(REAGENTS[rid as keyof typeof REAGENTS]).toBeTruthy();
      if (r.output !== "flask") expect(POTIONS[r.output]).toBeTruthy();
    }
  });

  it("only the flask bootstrap recipe is free of a flask catalyst", () => {
    for (const id of RECIPE_IDS) {
      if (id === "flask") expect(RECIPES[id].flasks).toBe(0);
      else expect(RECIPES[id].flasks).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("canCraft", () => {
  const health = RECIPES.health; // slimegel×2 + rotflesh×1 + 1 flask

  it("passes only when reagents AND flasks are all present", () => {
    const full: Pouch = { slimegel: 2, rotflesh: 1 };
    expect(canCraft(health, full, 1)).toBe(true);
    expect(canCraft(health, full, 0)).toBe(false); // no flask
    expect(canCraft(health, { slimegel: 2 }, 1)).toBe(false); // missing rotflesh
    expect(canCraft(health, { slimegel: 1, rotflesh: 1 }, 1)).toBe(false); // short a gel
    expect(canCraft(health, {}, 5)).toBe(false); // no reagents at all
  });

  it("treats a missing reagent as zero, not undefined", () => {
    expect(canCraft(health, { rotflesh: 1 }, 1)).toBe(false);
  });

  it("gates on gold when a recipe charges a fee", () => {
    const elixir = RECIPES.elixir; // grimbone×1 + ectoplasm×1 + slimegel×2, 2 flasks, 40g
    const pouch: Pouch = { grimbone: 1, ectoplasm: 1, slimegel: 2 };
    expect(canCraft(elixir, pouch, 2, 40)).toBe(true);
    expect(canCraft(elixir, pouch, 2, 39)).toBe(false); // one gold short
    expect(canCraft(elixir, pouch, 1, 999)).toBe(false); // one flask short
    // Recipes with no fee don't care about the gold arg (default Infinity).
    expect(canCraft(RECIPES.health, { slimegel: 2, rotflesh: 1 }, 1)).toBe(true);
  });
});

describe("craftCost", () => {
  it("reports the exact reagents, flasks and gold to subtract", () => {
    const cost = craftCost(RECIPES.elixir);
    expect(cost.flasks).toBe(2);
    expect(cost.gold).toBe(40);
    const asMap = Object.fromEntries(cost.inputs);
    expect(asMap).toEqual({ grimbone: 1, ectoplasm: 1, slimegel: 2 });
  });

  it("defaults gold to 0 when a recipe has no fee", () => {
    expect(craftCost(RECIPES.health).gold).toBe(0);
  });

  it("cost exactly empties a pouch that just barely afforded the craft", () => {
    // The invariant the tavern relies on: subtract the cost from a minimal
    // pouch and every counted reagent lands at 0 (never negative).
    const r = RECIPES.stoneskin; // ironshard×2 + lodestone×1
    const pouch: Record<string, number> = { ironshard: 2, lodestone: 1 };
    expect(canCraft(r, pouch, 1)).toBe(true);
    for (const [id, n] of craftCost(r).inputs) pouch[id] -= n;
    expect(pouch.ironshard).toBe(0);
    expect(pouch.lodestone).toBe(0);
  });
});
