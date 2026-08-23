/**
 * CARD LEVELS & SHINIES — the same monster, a different card.
 *
 * The complaint this system answers: a Spider Silk off floor 1 and a Spider Silk
 * off floor 17 were byte-identical, so the twelfth copy of a common was worth
 * exactly as much as the first.
 *
 * These pin the two rules that make levelling honest rather than a blanket buff:
 *   1. CANONICAL ENCODING — a level-1 plain card is the bare base id, so the
 *      haul screen can stack by raw string equality and nothing in the game ever
 *      holds two spellings of the same card.
 *   2. DELTAS SCALE BOTH WAYS — a levelled drawback card has a BIGGER drawback.
 *      Scaling only the upside would launder every downside card into a strict
 *      upgrade, which is the one thing the card design says it isn't.
 */
import { describe, it, expect } from "vitest";
import {
  CARDS,
  CARD_IDS,
  CARD_LEVEL_MAX,
  SHINY_CHANCE,
  aggregateCards,
  cardBase,
  cardDef,
  cardGrowth,
  cardKey,
  cardLevel,
  describeModifier,
  isShinyCard,
  parseCard,
  reKeyCard,
  rollCardLevel,
  rollCardInstance,
  rollShiny,
  scaleModifier,
} from "./cards";

/** A deterministic uniform stream, so every rate assertion below is repeatable. */
function lcg(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

describe("instance ids round-trip", () => {
  it("collapses level 1 plain back to the bare catalogue id", () => {
    // THE canonicalisation rule. Two spellings of the same card would make the
    // haul's string-equality stacking silently miss duplicates.
    expect(cardKey("spidersilk", 1, false)).toBe("spidersilk");
    expect(cardKey("spidersilk")).toBe("spidersilk");
  });

  it("encodes level and shine", () => {
    expect(cardKey("spidersilk", 4, false)).toBe("spidersilk#4");
    expect(cardKey("spidersilk", 4, true)).toBe("spidersilk#4s");
    // A shiny level 1 is NOT the bare id — the shine is real state.
    expect(cardKey("spidersilk", 1, true)).toBe("spidersilk#1s");
  });

  it("round-trips every card at every level, plain and shiny", () => {
    for (const base of CARD_IDS) {
      for (let lv = 1; lv <= CARD_LEVEL_MAX; lv++) {
        for (const shiny of [false, true]) {
          const key = cardKey(base, lv, shiny);
          expect(parseCard(key)).toEqual({ base, level: lv, shiny });
          expect(cardBase(key)).toBe(base);
          expect(cardLevel(key)).toBe(lv);
          expect(isShinyCard(key)).toBe(shiny);
        }
      }
    }
  });

  it("reads an unparseable id as level 1 plain rather than throwing", () => {
    // A hand-typed dev id or a wire value from an older peer must not crash the
    // render path. Tolerance here is deliberate.
    expect(parseCard("spidersilk")).toEqual({ base: "spidersilk", level: 1, shiny: false });
    expect(parseCard("spidersilk#")).toEqual({ base: "spidersilk", level: 1, shiny: false });
    expect(parseCard("spidersilk#zzz")).toEqual({ base: "spidersilk", level: 1, shiny: false });
    expect(cardDef("nosuchcard#4")).toBeUndefined();
  });

  it("clamps a level outside the range instead of trusting it", () => {
    expect(parseCard("spidersilk#99").level).toBe(CARD_LEVEL_MAX);
    expect(parseCard("spidersilk#0").level).toBe(1);
  });

  it("re-keys to a new base and KEEPS the level you earned", () => {
    // The tavern reroll and the un-socket tier drop both change WHICH card it
    // is. Losing the level there would make a reroll a punishment.
    expect(reKeyCard("spidersilk#6s", "goblintooth")).toBe("goblintooth#6s");
    expect(reKeyCard("spidersilk", "goblintooth")).toBe("goblintooth");
  });
});

describe("cardDef resolves a world card", () => {
  it("hands back the catalogue def untouched for a bare id", () => {
    expect(cardDef("spidersilk")).toBe(CARDS.spidersilk);
  });

  it("keeps identity — label, rarity, source, weapon fit — across levels", () => {
    // A level is a magnitude, never a re-skin. The bestiary's "farm Hulks for
    // the Hulk card" has to survive levelling.
    for (const base of CARD_IDS) {
      const d = cardDef(cardKey(base, 7, true))!;
      expect(d.label).toBe(CARDS[base].label);
      expect(d.rarity).toBe(CARDS[base].rarity);
      expect(d.source).toBe(CARDS[base].source);
      expect(d.subType).toBe(CARDS[base].subType);
      expect(d.weaponKinds).toBe(CARDS[base].weaponKinds);
      expect(d.base).toBe(base);
      expect(d.level).toBe(7);
      expect(d.shiny).toBe(true);
    }
  });

  it("never mutates the catalogue", () => {
    const before = JSON.stringify(CARDS.hulkknuckle.modifier);
    cardDef("hulkknuckle#9s");
    expect(JSON.stringify(CARDS.hulkknuckle.modifier)).toBe(before);
  });
});

describe("stats scale with the level", () => {
  it("grows the upside", () => {
    const lv1 = cardDef("spidersilk")!.modifier.damageMult!; // 1.2 → +20%
    const lv5 = cardDef("spidersilk#5")!.modifier.damageMult!;
    expect(lv5).toBeGreaterThan(lv1);
    // +20% delta × growth(5) = 1 + 0.12*4 = 1.48 → +29.6%
    expect(lv5).toBeCloseTo(1 + 0.2 * cardGrowth(5, false), 3);
  });

  /**
   * THE RULE THAT KEEPS LEVELLING HONEST. Hulk Knuckle is +60% damage for +15%
   * cooldown. If only the damage scaled, a level-10 Hulk Knuckle would be a
   * strictly better card than a level-1 with no trade left in it — and the
   * downside cards are a design pillar (see cards.ts).
   */
  it("grows the DRAWBACK too", () => {
    const lv1 = cardDef("hulkknuckle")!.modifier;
    const lv9 = cardDef("hulkknuckle#9")!.modifier;
    expect(lv9.damageMult!).toBeGreaterThan(lv1.damageMult!);
    expect(lv9.cooldownMult!).toBeGreaterThan(lv1.cooldownMult!); // slower, not faster
  });

  it("grows a durability PENALTY downward", () => {
    // Glass Cannon: +120% damage, −60% durability. Both halves must deepen.
    const lv1 = cardDef("gladeath")!.modifier;
    const lv8 = cardDef("gladeath#8")!.modifier;
    expect(lv8.damageMult!).toBeGreaterThan(lv1.damageMult!);
    expect(lv8.durabilityMult!).toBeLessThan(lv1.durabilityMult!);
  });

  it("makes a cooldown card FASTER as it levels, never inverted", () => {
    // cooldownMult below 1 is the good outcome, so the delta scaling has to
    // carry it further BELOW 1. A sign slip here would turn every speed card
    // into a penalty at high level.
    const lv1 = cardDef("midgetclaw")!.modifier.cooldownMult!;
    const lv10 = cardDef("midgetclaw#10")!.modifier.cooldownMult!;
    expect(lv10).toBeLessThan(lv1);
    expect(lv10).toBeGreaterThanOrEqual(0.35);
  });

  it("never lets a levelled card give LESS of an integer stat", () => {
    // round(1 * 1.12) is still 1 — fine — but it must never floor to 0, or a
    // level-2 pierce card would be worse than its level-1 twin.
    for (const base of CARD_IDS) {
      const m1 = CARDS[base].modifier;
      for (let lv = 1; lv <= CARD_LEVEL_MAX; lv++) {
        const m = cardDef(cardKey(base, lv))!.modifier;
        if (m1.pierce) expect(m.pierce!, `${base} lv${lv} pierce`).toBeGreaterThanOrEqual(m1.pierce);
        if (m1.lifesteal) expect(m.lifesteal!, `${base} lv${lv} lifesteal`).toBeGreaterThanOrEqual(m1.lifesteal);
        if (m1.damageFlat) expect(m.damageFlat!, `${base} lv${lv} flat`).toBeGreaterThanOrEqual(m1.damageFlat);
      }
    }
  });

  it("holds every clamp at the maximum level, shiny included", () => {
    for (const base of CARD_IDS) {
      const m = cardDef(cardKey(base, CARD_LEVEL_MAX, true))!.modifier;
      if (m.cooldownMult !== undefined) {
        expect(m.cooldownMult, `${base} cooldown`).toBeGreaterThanOrEqual(0.35);
        expect(m.cooldownMult, `${base} cooldown`).toBeLessThanOrEqual(2);
      }
      if (m.durabilityMult !== undefined) expect(m.durabilityMult, `${base} dur`).toBeGreaterThanOrEqual(0.05);
      if (m.critChance !== undefined) expect(m.critChance, `${base} crit`).toBeLessThanOrEqual(0.9);
      if (m.critMult !== undefined) expect(m.critMult, `${base} critmult`).toBeLessThanOrEqual(6);
    }
  });

  it("leaves the booleans alone — a status has no magnitude", () => {
    const m = cardDef("venomgland#10s")!.modifier;
    expect(m.onHit).toBe("burn");
    expect(cardDef("wispspark#10s")!.modifier.bolt).toBe(true);
  });

  it("is a no-op at growth 1", () => {
    expect(scaleModifier(CARDS.spidersilk.modifier, 1)).toBe(CARDS.spidersilk.modifier);
  });
});

describe("shiny", () => {
  it("beats the same card at the same level", () => {
    const plain = cardDef("spidersilk#3")!.modifier.damageMult!;
    const shiny = cardDef("spidersilk#3s")!.modifier.damageMult!;
    expect(shiny).toBeGreaterThan(plain);
  });

  /**
   * The bound that keeps RARITY meaningful. If a shiny common out-damaged a
   * plain epic of the same level, the rarity tiers would stop being a ladder
   * and the whole drop table would collapse into "hope for shine".
   */
  it("does not let a shiny common beat a plain epic of the same level", () => {
    const shinyCommon = cardDef("spidersilk#5s")!.modifier.damageMult!; // common, +20% base
    const plainEpic = cardDef("crawlergrip#5")!.modifier.damageMult!; // epic, +40% base
    expect(shinyCommon).toBeLessThan(plainEpic);
  });

  it("drops at roughly the advertised rate, and twice as often off a boss", () => {
    const rate = (boss: boolean): number => {
      const rand = lcg(11);
      let n = 0;
      for (let k = 0; k < 40000; k++) if (rollShiny(boss, rand)) n++;
      return n / 40000;
    };
    const mob = rate(false);
    expect(mob).toBeGreaterThan(SHINY_CHANCE * 0.75);
    expect(mob).toBeLessThan(SHINY_CHANCE * 1.25);
    expect(rate(true)).toBeGreaterThan(mob * 1.5);
  });
});

describe("levels ride the floor", () => {
  it("stays in range at any depth", () => {
    const rand = lcg(3);
    for (const floor of [1, 2, 5, 12, 30, 100]) {
      for (let k = 0; k < 500; k++) {
        const lv = rollCardLevel(floor, rand);
        expect(lv).toBeGreaterThanOrEqual(1);
        expect(lv).toBeLessThanOrEqual(CARD_LEVEL_MAX);
        expect(Number.isInteger(lv)).toBe(true);
      }
    }
  });

  it("hands out higher levels the deeper you go — the whole point", () => {
    const mean = (floor: number): number => {
      const rand = lcg(29);
      let sum = 0;
      for (let k = 0; k < 4000; k++) sum += rollCardLevel(floor, rand);
      return sum / 4000;
    };
    const shallow = mean(1);
    const mid = mean(9);
    const deep = mean(19);
    expect(mid).toBeGreaterThan(shallow);
    expect(deep).toBeGreaterThan(mid);
    // Floor 1 must still be a floor-1 reward, not a lottery.
    expect(shallow).toBeLessThan(1.6);
  });

  it("rolls a whole instance off a drop, base id intact", () => {
    const rand = lcg(17);
    let drops = 0;
    for (let k = 0; k < 4000; k++) {
      const id = rollCardInstance({ boss: false, floor: 8, kind: "spider" }, rand);
      if (!id) continue;
      drops++;
      expect(cardDef(id), id).toBeTruthy();
      expect(CARDS[cardBase(id)], id).toBeTruthy();
    }
    expect(drops).toBeGreaterThan(0);
  });
});

describe("the aggregate folds levelled cards", () => {
  it("a levelled socket beats a plain one", () => {
    const plain = aggregateCards(["spidersilk"]);
    const levelled = aggregateCards(["spidersilk#8"]);
    expect(levelled.damageMult).toBeGreaterThan(plain.damageMult);
  });

  it("still resolves set bonuses off levelled cards", () => {
    // The STORM set (2+ bolt cards) counts CARDS, not levels — a levelled bolt
    // card must still count toward it.
    const set = aggregateCards(["wispspark#4", "tempestcrown#2s"]);
    expect(set.bolt).toBe(true);
    expect(set.damageMult).toBeGreaterThan(1.25);
  });

  it("ignores a card whose base isn't in the catalogue", () => {
    expect(aggregateCards(["nosuchthing#4s"])).toEqual(aggregateCards([]));
  });
});

describe("a levelled card tells the truth about itself", () => {
  it("regenerates the description instead of repeating the level-1 text", () => {
    // The authored string says "+20% damage". At level 8 that is a LIE, and a
    // card that misreports its own stats is worse than one with no text.
    expect(CARDS.spidersilk.description).toContain("20%");
    expect(cardDef("spidersilk#8")!.description).not.toContain("+20% damage");
    expect(cardDef("spidersilk#8")!.description).toContain("damage");
  });

  it("keeps the authored text for a plain level-1 card", () => {
    expect(cardDef("spidersilk")!.description).toBe(CARDS.spidersilk.description);
  });

  it("says FASTER, never a signed cooldown percent", () => {
    // "−12%" on a speed-up and "+15%" on a penalty is correct arithmetic and a
    // backwards player-facing claim; the face has said faster/slower for a while
    // and the generated line must not regress it.
    expect(describeModifier({ cooldownMult: 0.8 })).toContain("faster");
    expect(describeModifier({ cooldownMult: 1.2 })).toContain("slower");
  });

  it("generates a non-empty line for every card at every level", () => {
    for (const base of CARD_IDS) {
      for (const lv of [1, 5, CARD_LEVEL_MAX]) {
        const d = cardDef(cardKey(base, lv, true))!;
        expect(d.description.length, `${base} lv${lv}`).toBeGreaterThan(0);
      }
    }
  });
});
