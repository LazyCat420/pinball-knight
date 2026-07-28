import { describe, expect, it } from "vitest";
import {
  scoreRun,
  runDetail,
  SCORE_PER_FLOOR,
  SCORE_PER_COMBO,
  SCORE_PER_KILL,
  type RunStats,
} from "./run-score";

const base: RunStats = {
  deepestFloor: 1,
  bestCombo: 0,
  kills: 0,
  gold: 0,
  durationS: 0,
};

describe("run scoring", () => {
  it("scores reaching floor 1 as a floor", () => {
    // Not zero: you did reach the floor. A zero here would make every early
    // death indistinguishable from never having played.
    expect(scoreRun(base)).toBe(SCORE_PER_FLOOR);
  });

  it("never returns a negative score", () => {
    expect(scoreRun({ ...base, deepestFloor: 0, kills: -5 })).toBeGreaterThanOrEqual(0);
  });

  /**
   * The load-bearing property. Pinball Knight is a descent and death restarts
   * at floor 1, so the board must not reward farming a safe early floor — that
   * is the exact pressure the Death Dealer exists to create.
   */
  it("ranks one extra floor above any amount of farming on the floor above", () => {
    const deeper = scoreRun({ ...base, deepestFloor: 2 });
    const farmed = scoreRun({
      ...base,
      deepestFloor: 1,
      kills: Math.ceil(SCORE_PER_FLOOR / SCORE_PER_KILL) - 1,
      bestCombo: Math.ceil(SCORE_PER_FLOOR / SCORE_PER_COMBO) - 1,
    });
    expect(deeper).toBeGreaterThan(scoreRun({ ...base, deepestFloor: 1 }));
    // A floor is worth more than everything else a single floor can yield.
    expect(scoreRun({ ...base, deepestFloor: 20 })).toBeGreaterThan(farmed);
  });

  it("uses combo and kills as tiebreakers at equal depth", () => {
    const plain = scoreRun({ ...base, deepestFloor: 5 });
    const stylish = scoreRun({ ...base, deepestFloor: 5, bestCombo: 10 });
    const bloody = scoreRun({ ...base, deepestFloor: 5, kills: 10 });
    expect(stylish).toBeGreaterThan(plain);
    expect(bloody).toBeGreaterThan(plain);
    // Combo outweighs kills per unit — style is the pinball axis.
    expect(stylish).toBeGreaterThan(bloody);
  });

  it("returns whole numbers", () => {
    expect(Number.isInteger(scoreRun({ ...base, deepestFloor: 3, gold: 7 }))).toBe(true);
  });

  /**
   * THE SHOT LAYER. Orbits, named combos and jackpots are an entire second
   * skill system that used to pay gold and nothing else, so a run that played
   * the machine like a machine scored the same as one that walked it.
   */
  describe("the shot layer", () => {
    const at5: RunStats = { ...base, deepestFloor: 5 };

    it("pays for every shot-layer axis", () => {
      const plain = scoreRun(at5);
      expect(scoreRun({ ...at5, namedShots: 1 })).toBeGreaterThan(plain);
      expect(scoreRun({ ...at5, orbitLaps: 1 })).toBeGreaterThan(plain);
      expect(scoreRun({ ...at5, jackpots: 1 })).toBeGreaterThan(plain);
      expect(scoreRun({ ...at5, bestFlow: 1 })).toBeGreaterThan(plain);
      expect(scoreRun({ ...at5, flawlessFloors: 1 })).toBeGreaterThan(plain);
    });

    it("treats the fields as optional, so an old stats blob still scores", () => {
      expect(scoreRun(at5)).toBe(scoreRun({ ...at5, namedShots: 0, orbitLaps: 0, jackpots: 0 }));
    });

    it("clamps flow to 0..1 so a bad integral can't mint points", () => {
      expect(scoreRun({ ...at5, bestFlow: 99 })).toBe(scoreRun({ ...at5, bestFlow: 1 }));
      expect(scoreRun({ ...at5, bestFlow: -5 })).toBe(scoreRun({ ...at5, bestFlow: 0 }));
    });

    it("still puts DEPTH above a perfect floor's entire shot yield", () => {
      const perfectFloor = scoreRun({
        ...at5,
        namedShots: 3,
        orbitLaps: 2,
        jackpots: 1,
        bestFlow: 1,
        flawlessFloors: 1,
      });
      expect(scoreRun({ ...base, deepestFloor: 7 })).toBeGreaterThan(perfectFloor);
    });
  });
});

describe("run detail blob", () => {
  it("stays small and flat enough for the service's 2000-byte cap", () => {
    const d = runDetail({ deepestFloor: 12, bestCombo: 30, kills: 400, gold: 9999, durationS: 1234.7 });
    expect(JSON.stringify(d).length).toBeLessThan(2000);
    for (const v of Object.values(d)) expect(typeof v).toBe("number");
  });

  it("rounds the duration so the blob has no float noise", () => {
    expect(runDetail({ ...base, durationS: 12.6 }).seconds).toBe(13);
  });
});
