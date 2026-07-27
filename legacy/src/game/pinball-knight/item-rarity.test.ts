/**
 * ITEM RARITY, CARD SLOTS and UPGRADE RISK — the anti-hoard economy.
 *
 * The design rule these tests defend: NOTHING IS PERMANENT. Power has to be
 * losable or the run stops being a run — players hoard one god-item and the
 * game is over. Upgrade risk is the mechanism, so its numbers have to be honest
 * (the confirm dialog shows the same chance that is actually rolled) and its
 * curve has to be a real ramp rather than a cliff.
 */
import { describe, it, expect } from "vitest";
import {
  ITEM_RARITIES,
  SLOTS_BY_RARITY,
  WEAPON_MAX_CARD_SLOTS,
  slotsForRarity,
  weaponSlotCount,
  gearSlotCount,
  freshWeapon,
  freshGearPiece,
  rollItemRarity,
  breakChance,
  upgradeDamageMult,
  upgradeDurabilityMult,
  UPGRADE_SAFE_LEVEL,
  UPGRADE_RISK_CAP,
} from "./items";

/** Deterministic uniform stream, so every rate assertion is repeatable. */
function lcg(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

describe("card slots come from ITEM RARITY", () => {
  it("runs 1-4 across the tiers, and 4 is the hard cap", () => {
    expect(ITEM_RARITIES.map((r) => SLOTS_BY_RARITY[r])).toEqual([1, 2, 3, 4]);
    expect(WEAPON_MAX_CARD_SLOTS).toBe(4);
  });

  it("never exceeds the cap, however many slots were bought", () => {
    expect(slotsForRarity("legendary", 3)).toBe(WEAPON_MAX_CARD_SLOTS);
    expect(slotsForRarity("common", 99)).toBe(WEAPON_MAX_CARD_SLOTS);
  });

  it("treats a rarity-less item as common (old saves must not crash)", () => {
    expect(slotsForRarity(undefined)).toBe(SLOTS_BY_RARITY.common);
    expect(weaponSlotCount({ id: "sword", durability: 10 })).toBe(SLOTS_BY_RARITY.common);
  });

  it("gives weapons and gear the SAME allowance at the same rarity", () => {
    // Cards upgrade the GEAR — armour is not a second-class socket.
    for (const r of ITEM_RARITIES) {
      expect(weaponSlotCount(freshWeapon("sword", r))).toBe(gearSlotCount(freshGearPiece(r)));
    }
  });

  it("reports 0 slots for an empty gear slot", () => {
    expect(gearSlotCount(undefined)).toBe(0);
  });
});

describe("rollItemRarity", () => {
  it("only ever returns a real rarity", () => {
    const rand = lcg(3);
    for (let i = 0; i < 5000; i++) {
      expect(ITEM_RARITIES).toContain(rollItemRarity(1 + (i % 12), rand));
    }
  });

  it("biases higher with depth without ever guaranteeing a tier", () => {
    const share = (floor: number, want: string): number => {
      const rand = lcg(11);
      let n = 0;
      for (let i = 0; i < 20000; i++) if (rollItemRarity(floor, rand) === want) n++;
      return n / 20000;
    };
    // Commons fade as you descend; legendaries appear only in the deep.
    expect(share(1, "common")).toBeGreaterThan(share(10, "common"));
    expect(share(10, "legendary")).toBeGreaterThan(share(1, "legendary"));
    // A floor-1 legendary must be impossible, and a deep floor must never be
    // ALL legendaries — a guaranteed tier ends the hunt.
    expect(share(1, "legendary")).toBe(0);
    expect(share(20, "legendary")).toBeLessThan(0.35);
    // …and a common is always still on the table, however deep you go.
    expect(share(20, "common")).toBeGreaterThan(0);
  });
});

describe("UPGRADE RISK — nothing is permanent", () => {
  it("is completely SAFE below the safe level, so the system teaches first", () => {
    for (let lvl = 0; lvl < UPGRADE_SAFE_LEVEL; lvl++) {
      expect(breakChance(lvl), `level ${lvl} should be risk-free`).toBe(0);
    }
  });

  it("starts biting exactly at the safe level", () => {
    expect(breakChance(UPGRADE_SAFE_LEVEL)).toBeGreaterThan(0);
  });

  it("climbs monotonically and never passes the cap", () => {
    let prev = -1;
    for (let lvl = 0; lvl <= 40; lvl++) {
      const c = breakChance(lvl);
      expect(c).toBeGreaterThanOrEqual(prev);
      expect(c).toBeLessThanOrEqual(UPGRADE_RISK_CAP);
      prev = c;
    }
    // The cap must actually be REACHED, or the ceiling is decorative.
    expect(breakChance(40)).toBe(UPGRADE_RISK_CAP);
  });

  it("is never a certainty — a maxed weapon is a gamble, not a doomed one", () => {
    expect(UPGRADE_RISK_CAP).toBeLessThan(1);
  });

  it("ignores nonsense levels rather than returning NaN", () => {
    expect(breakChance(-5)).toBe(0);
    expect(breakChance(2.7)).toBe(breakChance(2));
  });

  it("pays for the risk: each level is stronger and tougher", () => {
    expect(upgradeDamageMult(0)).toBe(1);
    expect(upgradeDurabilityMult(0)).toBe(1);
    for (let lvl = 1; lvl <= 8; lvl++) {
      expect(upgradeDamageMult(lvl)).toBeGreaterThan(upgradeDamageMult(lvl - 1));
      expect(upgradeDurabilityMult(lvl)).toBeGreaterThan(upgradeDurabilityMult(lvl - 1));
    }
  });

  it("treats a never-upgraded item as level 0", () => {
    expect(upgradeDamageMult()).toBe(1);
    expect(upgradeDurabilityMult()).toBe(1);
    expect(freshWeapon("sword").upgrade).toBe(0);
  });
});
