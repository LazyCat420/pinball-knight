import { describe, it, expect } from "vitest";
import { CARDS, CARD_IDS, aggregateCards, cardFitsKind, cardsOfRarity, cardsOfSource, rollCardDrop, socketCard, COMMON_DROP_CHANCE } from "./cards";
import { freshWeapon } from "./items";

describe("cards", () => {
  it("every card has a valid rarity, kind and at least one effect", () => {
    for (const id of CARD_IDS) {
      const c = CARDS[id];
      expect(["common", "rare", "epic", "legendary", "mythic"]).toContain(c.rarity);
      expect(["melee", "ranged", "both"]).toContain(c.weaponKinds);
      const m = c.modifier;
      const hasEffect = m.damageFlat || m.damageMult || m.cooldownMult || m.durabilityMult || m.onHit || m.pinballMult || m.bolt || m.materialMult || m.critChance || m.lifesteal || m.pierce || m.grantsAbility || m.abilityCostMult;
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
    expect(agg).toEqual({ damageFlat: 0, damageMult: 1, cooldownMult: 1, durabilityMult: 1, chill: false, burn: false, pinballMult: 1, bolt: false, materialMult: 1, critChance: 0, critMult: 2, lifesteal: 0, pierce: 0, unlocked: [], abilityCostMult: 1 });
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

/** A deterministic uniform stream, so every rate assertion below is repeatable. */
function lcg(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

describe("monster affinity (CardDef.source)", () => {
  it("sources every card to a real monster, or deliberately to none", () => {
    // Mythics are Tavern chase cards and must stay sourceless — if one picks up
    // a source it silently enters the dungeon loot pool.
    for (const id of CARD_IDS) {
      const c = CARDS[id];
      if (c.rarity === "mythic") expect(c.source, `${id} is a mythic with a source`).toBeUndefined();
    }
  });

  it("gives the affinity roll something to find at the common tier", () => {
    // A source that only appears on rare+ cards can never be farmed off the
    // ~8% common drop, which is where almost all real drops come from.
    const commonSources = cardsOfRarity("common").map((id) => CARDS[id].source).filter(Boolean);
    expect(new Set(commonSources).size).toBeGreaterThan(1);
  });

  it("biases a dropped card toward the slain monster's own pool", () => {
    const rand = lcg(7);
    let own = 0;
    let foreign = 0;
    for (let k = 0; k < 20000; k++) {
      const id = rollCardDrop({ boss: false, floor: 1, kind: "ghost" }, rand);
      if (!id) continue;
      if (CARDS[id].source === "ghost") own++;
      else foreign++;
    }
    expect(own).toBeGreaterThan(0);
    // Affinity is 70%, so the monster's own card must dominate — but not totally,
    // or the rest of the table would be unreachable off that monster.
    expect(own).toBeGreaterThan(foreign);
    expect(foreign).toBeGreaterThan(0);
  });

  /**
   * THE INVARIANT. Affinity chooses WHICH card drops, never WHETHER one does.
   * The affinity coin-flip draws from the same `rand` stream as the rarity gates,
   * so drawing it in the wrong order would shift the gates and inflate the rate —
   * a silent buff to every kill in the game.
   */
  it("does NOT change the total drop rate", () => {
    const count = (kind?: "ghost"): number => {
      const rand = lcg(99);
      let drops = 0;
      for (let k = 0; k < 40000; k++) {
        if (rollCardDrop({ boss: false, floor: 1, kind }, rand)) drops++;
      }
      return drops;
    };
    const withAffinity = count("ghost");
    const without = count(undefined);
    // Same gates, same base rate. Allow a little slack: the affinity branch
    // consumes extra draws from the shared stream, which reshuffles WHICH kills
    // drop without changing HOW OFTEN they do.
    expect(Math.abs(withAffinity - without) / without).toBeLessThan(0.12);
    // …and both must sit near the advertised ~8%. A loose band on purpose: this
    // asserts the RATE hasn't been restructured, and the small LCG above has its
    // own sampling bias — tightening it would test the generator, not the code.
    expect(without / 40000).toBeGreaterThan(COMMON_DROP_CHANCE * 0.8);
    expect(without / 40000).toBeLessThan(COMMON_DROP_CHANCE * 1.2);
  });

  it("scales the common drop with the sub-type loot multiplier, but caps it", () => {
    const rate = (dropMult: number): number => {
      const rand = lcg(5);
      let drops = 0;
      for (let k = 0; k < 20000; k++) {
        if (rollCardDrop({ boss: false, floor: 1, dropMult }, rand)) drops++;
      }
      return drops / 20000;
    };
    expect(rate(2)).toBeGreaterThan(rate(1));
    // A hulk drops more, but a card must never stop being a rare event.
    expect(rate(2)).toBeLessThan(0.25);
    // Absurd input is CLAMPED rather than becoming a guarantee. The clamp is
    // exactly 0.5, so a sampled rate sits either side of it — the assertion that
    // matters is that it stops well short of every kill dropping a card.
    expect(rate(100)).toBeLessThan(0.55);
  });

  it("falls back to the rarity pool for a monster with no cards of its own", () => {
    const rand = lcg(3);
    let drops = 0;
    for (let k = 0; k < 5000; k++) {
      // `pin` has no COMMON card, so every common drop off a pin must come from
      // the pool at large rather than returning undefined.
      const id = rollCardDrop({ boss: false, floor: 1, kind: "pin" }, rand);
      if (id) {
        expect(CARDS[id]).toBeTruthy();
        drops++;
      }
    }
    expect(drops).toBeGreaterThan(0);
  });
});

describe("skill cards (CardModifier.grantsAbility)", () => {
  const SKILL_CARDS = CARD_IDS.filter((id) => CARDS[id].modifier.grantsAbility);

  it("ships one skill card per LOCKABLE ability, each sourced from a monster", () => {
    // The ceiling is 3 on purpose: magnetaura / timecrawl / bladestorm are the
    // only abilities not already in state.unlockedAbilities, so those are the only
    // ones a card can meaningfully grant. The rest of the monster roster carries
    // ability-COST discounts instead.
    expect(SKILL_CARDS.length).toBe(3);
    for (const id of SKILL_CARDS) expect(CARDS[id].source, `${id} needs a source`).toBeTruthy();
    expect(SKILL_CARDS.map((id) => CARDS[id].modifier.grantsAbility).sort()).toEqual([
      "bladestorm",
      "magnetaura",
      "timecrawl",
    ]);
  });

  it("collects granted abilities into the aggregate", () => {
    const agg = aggregateCards(["magnetheart", "reaperclock"]);
    expect(agg.unlocked).toContain("magnetaura");
    expect(agg.unlocked).toContain("timecrawl");
  });

  it("dedupes a doubled grant — two copies is still one ability", () => {
    const agg = aggregateCards(["magnetheart", "magnetheart"]);
    expect(agg.unlocked).toEqual(["magnetaura"]);
  });

  it("grants nothing from a socket-free weapon", () => {
    expect(aggregateCards([]).unlocked).toEqual([]);
    expect(aggregateCards(undefined).unlocked).toEqual([]);
  });

  it("compounds ability cost discounts multiplicatively", () => {
    expect(aggregateCards(["witchfocus"]).abilityCostMult).toBeCloseTo(0.75);
    expect(aggregateCards(["witchfocus", "reaperclock"]).abilityCostMult).toBeCloseTo(0.6);
    expect(aggregateCards(["wispspark"]).abilityCostMult).toBeCloseTo(0.65);
    expect(aggregateCards(["bloodedge"]).abilityCostMult).toBe(1);
  });

  it("un-socketing removes the grant", () => {
    const w = freshWeapon("mace"); // 2 slots
    expect(socketCard(w, "magnetheart")).toBe(true);
    expect(aggregateCards(w.cards).unlocked).toContain("magnetaura");
    w.cards = w.cards!.filter((c) => c !== "magnetheart");
    expect(aggregateCards(w.cards).unlocked).toEqual([]);
  });

  it("keeps a melee-only skill card off a ranged weapon", () => {
    // Blade Storm is a melee fantasy; socketing it into a bow would hand a
    // ranged build a melee ability for free.
    expect(cardFitsKind("brutewhirl", "ranged")).toBe(false);
    expect(cardFitsKind("brutewhirl", "melee")).toBe(true);
    const bow = freshWeapon("bow");
    expect(socketCard(bow, "brutewhirl")).toBe(false);
  });
});
