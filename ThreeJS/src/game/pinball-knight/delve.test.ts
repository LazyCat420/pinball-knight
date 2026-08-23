import { describe, it, expect } from "vitest";
import { floorXpIncome, expectedProgress, planCatchUp } from "./delve";
import { xpForLevel } from "./skills";

const FRESH = { level: 1, xp: 0, points: 0, hearts: 0, upgrade: 0 };

describe("expectedProgress — what a knight who WALKED here would hold", () => {
  it("expects nothing at the top of the dungeon", () => {
    expect(expectedProgress(1)).toEqual({ xp: 0, level: 1, points: 0 });
  });

  it("rises monotonically with depth", () => {
    let prev = 0;
    for (let f = 1; f <= 20; f++) {
      const lvl = expectedProgress(f).level;
      expect(lvl).toBeGreaterThanOrEqual(prev);
      prev = lvl;
    }
  });

  it("hands out one skill point per level, exactly like real play", () => {
    const p = expectedProgress(8);
    expect(p.points).toBe(p.level - 1);
  });

  it("tracks the real XP curve rather than a second balance table", () => {
    // A floor's income is the horde it actually spawns; two floors of it must be
    // worth more than the first level-up costs, or the model is not modelling.
    expect(floorXpIncome(1) * 2).toBeGreaterThan(xpForLevel(1) + xpForLevel(2));
  });
});

describe("planCatchUp", () => {
  it("gives a fresh knight dropping onto a deep floor levels, hearts and a blade", () => {
    const boon = planCatchUp(12, FRESH);
    expect(boon).not.toBeNull();
    expect(boon!.levels).toBe(expectedProgress(12).level - 1);
    expect(boon!.points).toBe(boon!.levels);
    expect(boon!.hearts).toBeGreaterThan(0);
    expect(boon!.upgrade).toBeGreaterThan(0);
    expect(boon!.gear).toBe(true);
  });

  it("owes nothing on floor 1 — that is where a run is supposed to start", () => {
    expect(planCatchUp(1, FRESH)).toBeNull();
  });

  it("owes nothing to a knight who walked down honestly", () => {
    const at5 = expectedProgress(5);
    expect(planCatchUp(5, { level: at5.level, xp: at5.xp, points: at5.points, hearts: 6, upgrade: 5 })).toBeNull();
  });

  it("is a TOP-UP, never a downgrade: regrouping shallower grants nothing", () => {
    const deep = planCatchUp(14, FRESH)!;
    const after = { level: 1 + deep.levels, xp: 0, points: deep.points, hearts: deep.hearts, upgrade: deep.upgrade };
    expect(planCatchUp(3, after)).toBeNull();
  });

  it("caps the handout so a drop-in is a floor, not a shortcut", () => {
    const deep = planCatchUp(60, FRESH)!;
    expect(deep.hearts).toBeLessThanOrEqual(6);
    expect(deep.upgrade).toBeLessThanOrEqual(5);
  });

  it("scales with depth — floor 10 beats floor 3", () => {
    const shallow = planCatchUp(3, FRESH)!;
    const deep = planCatchUp(10, FRESH)!;
    expect(deep.levels).toBeGreaterThan(shallow.levels);
    expect(deep.hearts).toBeGreaterThanOrEqual(shallow.hearts);
  });
});
