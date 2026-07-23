import { describe, it, expect } from "vitest";
import { CARDS, CARD_IDS, aggregateCards, cardFitsKind, cardsOfRarity, rollCardDrop } from "./cards";

describe("cards", () => {
  it("every card has a valid rarity, kind and at least one effect", () => {
    for (const id of CARD_IDS) {
      const c = CARDS[id];
      expect(["common", "rare", "epic", "legendary", "mythic"]).toContain(c.rarity);
      expect(["melee", "ranged", "both"]).toContain(c.weaponKinds);
      const m = c.modifier;
      const hasEffect = m.damageFlat || m.damageMult || m.cooldownMult || m.durabilityMult || m.onHit || m.pinballMult || m.bolt || m.materialMult || m.critChance || m.lifesteal || m.pierce;
      expect(hasEffect, `${id} does nothing`).toBeTruthy();
    }
  });

  it("aggregates flat additively and percent/pinball/cooldown multiplicatively", () => {
    // bloodedge (+1 flat) + keenedge (×1.3) + sharpened (×0.85 cd)
    const agg = aggregateCards(["bloodedge", "keenedge", "sharpened"]);
    expect(agg.damageFlat).toBe(1);
    expect(agg.damageMult).toBeCloseTo(1.3);
    expect(agg.cooldownMult).toBeCloseTo(0.85);
    // a 2-damage weapon: 2 × 1.3 + 1 = 3.6
    expect(2 * agg.damageMult + agg.damageFlat).toBeCloseTo(3.6);
  });

  it("stacks the same rarity's multipliers (two keen edges = ×1.69)", () => {
    const agg = aggregateCards(["keenedge", "keenedge"]);
    expect(agg.damageMult).toBeCloseTo(1.69);
  });

  it("collects on-hit + pinball flags", () => {
    const agg = aggregateCards(["frostchip", "embercore", "pinballwizard"]);
    expect(agg.chill).toBe(true);
    expect(agg.burn).toBe(true);
    expect(agg.pinballMult).toBeGreaterThan(1);
  });

  it("collects the thunderbolt flag from storm cards", () => {
    expect(aggregateCards(["stormchain"]).bolt).toBe(true);
    expect(aggregateCards(["thunderlord"]).bolt).toBe(true);
    expect(aggregateCards(["keenedge"]).bolt).toBe(false);
  });

  it("empty / undefined sockets are a no-op", () => {
    const agg = aggregateCards(undefined);
    expect(agg).toEqual({ damageFlat: 0, damageMult: 1, cooldownMult: 1, durabilityMult: 1, chill: false, burn: false, pinballMult: 1, bolt: false, materialMult: 1, critChance: 0, critMult: 2, lifesteal: 0, pierce: 0 });
  });

  it("respects weapon-kind fit", () => {
    expect(cardFitsKind("bloodedge", "ranged")).toBe(true); // both
    expect(cardFitsKind("momentumstrike", "ranged")).toBe(false); // melee-only
    expect(cardFitsKind("momentumstrike", "melee")).toBe(true);
  });

  it("drop rates: a common floor mob drops nothing most of the time, sometimes a common", () => {
    let commons = 0;
    let others = 0;
    let n = 0;
    // deterministic stream of rands
    let seed = 1;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let k = 0; k < 2000; k++) {
      const id = rollCardDrop({ boss: false, floor: 1, legendaryAllowed: true }, rand);
      if (!id) { n++; continue; }
      if (CARDS[id].rarity === "common") commons++;
      else others++;
    }
    expect(commons).toBeGreaterThan(0);
    expect(others).toBe(0); // non-boss mobs never drop rare+
    expect(n).toBeGreaterThan(commons); // most kills drop nothing
  });

  it("a floor-5+ boss can drop a legendary; a floor-1 boss cannot", () => {
    const rand = (): number => 0.1; // always passes the < gates
    const deepBoss = rollCardDrop({ boss: true, floor: 6, legendaryAllowed: true }, rand);
    expect(deepBoss && CARDS[deepBoss].rarity).toBe("legendary");
    const shallowBoss = rollCardDrop({ boss: true, floor: 1, legendaryAllowed: true }, rand);
    expect(shallowBoss && CARDS[shallowBoss].rarity).not.toBe("legendary");
  });

  it("cardsOfRarity buckets are non-empty for every tier", () => {
    for (const r of ["common", "rare", "epic", "legendary", "mythic"] as const) {
      expect(cardsOfRarity(r).length).toBeGreaterThan(0);
    }
  });
});
