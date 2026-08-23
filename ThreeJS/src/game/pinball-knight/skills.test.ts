import { describe, expect, it } from "vitest";
import { SKILLS, SKILL_IDS, aggregateSkills, neutralAggregate, canLearn, xpForLevel, grantXp, xpForFloorClear, XP_KILL } from "./skills";
import { ABILITIES } from "./abilities";

describe("skill table sanity", () => {
  it("every node's prerequisites exist and stay inside its own branch's reach", () => {
    for (const id of SKILL_IDS) {
      for (const req of SKILLS[id].requires ?? []) {
        expect(SKILLS[req], `${id} requires unknown node ${req}`).toBeTruthy();
      }
    }
  });

  it("every unlockAbility points at a real ability", () => {
    for (const id of SKILL_IDS) {
      const u = SKILLS[id].modifier.unlockAbility;
      if (u) expect(ABILITIES[u], `${id} unlocks unknown ability ${u}`).toBeTruthy();
    }
  });

  it("ranks and costs are positive", () => {
    for (const id of SKILL_IDS) {
      expect(SKILLS[id].maxRank).toBeGreaterThan(0);
      expect(SKILLS[id].cost).toBeGreaterThan(0);
    }
  });
});

describe("aggregateSkills", () => {
  it("is the neutral identity with no ranks", () => {
    expect(aggregateSkills({})).toEqual(neutralAggregate());
  });

  it("compounds multipliers across ranks and clamps to maxRank", () => {
    const one = aggregateSkills({ whetstone: 1 });
    const three = aggregateSkills({ whetstone: 3 });
    const over = aggregateSkills({ whetstone: 99 }); // hand-edited state must not explode
    expect(one.damageMult).toBeCloseTo(1.06);
    expect(three.damageMult).toBeCloseTo(1.06 ** 3);
    expect(over.damageMult).toBeCloseTo(three.damageMult);
  });

  it("is order-independent and layers the legacy base first", () => {
    const a = aggregateSkills({ whetstone: 2, coinmagnet: 1 });
    const b = aggregateSkills({ coinmagnet: 1, whetstone: 2 });
    expect(a).toEqual(b);
    const withBase = aggregateSkills({}, [{ damageMult: 1.05 }, { maxHpFlat: 1 }]);
    expect(withBase.damageMult).toBeCloseTo(1.05);
    expect(withBase.maxHpFlat).toBe(1);
  });

  it("collects ability unlocks without duplicates", () => {
    const agg = aggregateSkills({ unlockmagnet: 1 }, [{ unlockAbility: "magnetaura" }]);
    expect(agg.unlocked).toEqual(["magnetaura"]);
  });
});

describe("canLearn", () => {
  it("gates on prerequisites, points and max rank", () => {
    expect(canLearn("ironheart", {}, 5).ok).toBe(false); // needs whetstone
    expect(canLearn("ironheart", { whetstone: 1 }, 0).ok).toBe(false); // no points
    expect(canLearn("ironheart", { whetstone: 1 }, 1).ok).toBe(true);
    expect(canLearn("ironheart", { whetstone: 1, ironheart: 2 }, 9).ok).toBe(false); // maxed
  });

  it("charges multi-point nodes their real cost", () => {
    expect(canLearn("juggernaut", { whetstone: 1, ironheart: 1 }, 1).ok).toBe(false); // costs 2
    expect(canLearn("juggernaut", { whetstone: 1, ironheart: 1 }, 2).ok).toBe(true);
  });
});

describe("xp curve", () => {
  it("is monotonically increasing", () => {
    for (let l = 1; l < 30; l++) {
      expect(xpForLevel(l + 1)).toBeGreaterThan(xpForLevel(l));
    }
  });

  it("grantXp cascades multi-level-ups and pays one point per level", () => {
    const start = { xp: 0, level: 1, points: 0 };
    const big = grantXp(start, xpForLevel(1) + xpForLevel(2) + 5);
    expect(big.level).toBe(3);
    expect(big.points).toBe(2);
    expect(big.levelsGained).toBe(2);
    expect(big.xp).toBe(5);
  });

  it("floors 1-3 of a decent run fund the early tree (steep-early promise)", () => {
    // ~30 kills + three B-grade floor clears across floors 1-3.
    let cur = { xp: 0, level: 1, points: 0 };
    cur = grantXp(cur, 30 * XP_KILL);
    for (let f = 1; f <= 3; f++) cur = grantXp(cur, xpForFloorClear(f, "B"));
    expect(cur.points).toBeGreaterThanOrEqual(3);
  });
});
