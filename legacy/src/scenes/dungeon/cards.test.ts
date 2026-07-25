import { describe, it, expect } from "vitest";
import { CARDS, CARD_IDS, aggregateCards, cardFitsKind, cardsOfRarity, cardsOfSource, rollCardDrop, COMMON_DROP_CHANCE } from "./cards";

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
    // Derived from the table, not hardcoded — a retune must not break the MATH
    // test, only the balance tests that deliberately pin numbers.
    const flat = CARDS.lurcherspine.modifier.damageFlat!;
    const mult = CARDS.spidersilk.modifier.damageMult!;
    const cd = CARDS.midgetclaw.modifier.cooldownMult!;
    const agg = aggregateCards(["lurcherspine", "spidersilk", "midgetclaw"]);
    expect(agg.damageFlat).toBe(flat);
    expect(agg.damageMult).toBeCloseTo(mult);
    expect(agg.cooldownMult).toBeCloseTo(cd);
    // flat is added AFTER the percent multiplier
    expect(2 * agg.damageMult + agg.damageFlat).toBeCloseTo(2 * mult + flat);
  });

  it("stacks the same card's multiplier multiplicatively", () => {
    const one = CARDS.spidersilk.modifier.damageMult!;
    const agg = aggregateCards(["spidersilk", "spidersilk"]);
    expect(agg.damageMult).toBeCloseTo(one * one);
  });

  it("collects on-hit + pinball flags", () => {
    const agg = aggregateCards(["crawlergrip", "necrosigil", "timeripper"]);
    expect(agg.chill).toBe(true);
    expect(agg.burn).toBe(true);
    expect(agg.pinballMult).toBeGreaterThan(1);
  });

  it("collects the thunderbolt flag from storm cards", () => {
    expect(aggregateCards(["wispspark"]).bolt).toBe(true);
    expect(aggregateCards(["tempestcrown"]).bolt).toBe(true);
    expect(aggregateCards(["spidersilk"]).bolt).toBe(false);
  });

  it("empty / undefined sockets are a no-op", () => {
    const agg = aggregateCards(undefined);
    expect(agg).toEqual({ damageFlat: 0, damageMult: 1, cooldownMult: 1, durabilityMult: 1, chill: false, burn: false, pinballMult: 1, bolt: false, materialMult: 1, critChance: 0, critMult: 2, lifesteal: 0, pierce: 0 });
  });

  it("respects weapon-kind fit", () => {
    expect(cardFitsKind("lurcherspine", "ranged")).toBe(true); // both
    expect(cardFitsKind("brutecleaver", "ranged")).toBe(false); // melee-only
    expect(cardFitsKind("brutecleaver", "melee")).toBe(true);
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
      // spider has a COMMON card; ghost's is epic and unreachable off a mob.
      const id = rollCardDrop({ boss: false, floor: 1, kind: "spider" }, rand);
      if (!id) continue;
      if (CARDS[id].source === "spider") own++;
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


/**
 * THE 25-CARD TABLE — the shape the rework committed to, and the rules that keep
 * it honest as it grows.
 */
describe("the card table", () => {
  const byRarity = (r: string): string[] => CARD_IDS.filter((id) => CARDS[id].rarity === r);

  it("is exactly 5 cards per rarity, 25 total", () => {
    for (const r of ["common", "rare", "epic", "legendary", "mythic"] as const) {
      expect(byRarity(r).length, `${r} should have 5`).toBe(5);
    }
    expect(CARD_IDS).toHaveLength(25);
  });

  it("sources every non-mythic to a monster, and no mythic to any", () => {
    for (const id of CARD_IDS) {
      const c = CARDS[id];
      if (c.rarity === "mythic") expect(c.source, `${id} is a mythic with a source`).toBeUndefined();
      else expect(c.source, `${id} has no monster`).toBeTruthy();
    }
  });

  it("gives all EIGHT zombie sub-types a card of their own", () => {
    const subs = CARD_IDS.map((id) => CARDS[id].subType).filter(Boolean);
    expect(new Set(subs).size).toBe(8);
    // …and each sub-type gets exactly one, so no sub-type is over-represented.
    expect(subs.length).toBe(8);
  });

  it("only sub-types ZOMBIE cards — the other kinds have no sub-types", () => {
    for (const id of CARD_IDS) {
      if (CARDS[id].subType) expect(CARDS[id].source, `${id}`).toBe("zombie");
    }
  });

  /**
   * Every mechanic needs TWO+ sources or its 2-card set bonus in aggregateCards
   * is unreachable, and the mechanic reads as a one-card orphan the player can
   * never build around.
   */
  it("gives every mechanic at least two cards", () => {
    const count = (pred: (m: (typeof CARDS)[string]["modifier"]) => unknown): number =>
      CARD_IDS.filter((id) => pred(CARDS[id].modifier)).length;
    expect(count((m) => m.bolt), ).toBeGreaterThanOrEqual(2);
    expect(count((m) => m.materialMult)).toBeGreaterThanOrEqual(2);
    expect(count((m) => m.critChance)).toBeGreaterThanOrEqual(2);
    expect(count((m) => m.pierce)).toBeGreaterThanOrEqual(2);
    expect(count((m) => m.lifesteal)).toBeGreaterThanOrEqual(2);
    expect(count((m) => m.pinballMult)).toBeGreaterThanOrEqual(2);
  });

  it("grants no ABILITIES — that is the skill tree's job", () => {
    // The two axes must not overlap: the tree upgrades the PLAYER, cards upgrade
    // the GEAR. A card handing out a Q/E ability blurs the only line that makes
    // having two progression systems worth it.
    for (const id of CARD_IDS) {
      expect("grantsAbility" in CARDS[id].modifier, `${id} grants an ability`).toBe(false);
    }
  });
});

describe("sub-type affinity", () => {
  it("drops the HULK card off a hulk, not just any zombie card", () => {
    const rand = lcg(21);
    let hulkCard = 0;
    let otherZombie = 0;
    for (let k = 0; k < 40000; k++) {
      const id = rollCardDrop({ boss: true, floor: 6, kind: "zombie", subType: "hulk" }, rand);
      if (!id) continue;
      if (CARDS[id].subType === "hulk") hulkCard++;
      else if (CARDS[id].source === "zombie") otherZombie++;
    }
    expect(hulkCard).toBeGreaterThan(0);
    // A hulk must never hand you a different sub-type's card — "farm Hulks for
    // the Hulk card" has to mean something.
    expect(otherZombie).toBe(0);
  });

  it("never gives a MIDGET the hulk's card", () => {
    const rand = lcg(5);
    for (let k = 0; k < 20000; k++) {
      const id = rollCardDrop({ boss: false, floor: 3, kind: "zombie", subType: "midget" }, rand);
      if (id) expect(CARDS[id].subType === "hulk").toBe(false);
    }
  });

  it("still drops family cards for a kind with no sub-types", () => {
    const rand = lcg(9);
    let n = 0;
    for (let k = 0; k < 20000; k++) if (rollCardDrop({ boss: false, floor: 2, kind: "spider" }, rand)) n++;
    expect(n).toBeGreaterThan(0);
  });
});
