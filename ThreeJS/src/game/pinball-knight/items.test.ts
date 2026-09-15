import { describe, it, expect } from "vitest";
import { WEAPONS, PICKUP_WEAPONS, freshWeapon, degradeWeapon, absorbDamage, GEAR, tierForFloor, weaponsForFloor, potionsForFloor, type GearState } from "./items";

describe("weapon durability", () => {
  it("every weapon table entry is coherent", () => {
    for (const w of Object.values(WEAPONS)) {
      expect(w.damage).toBeGreaterThan(0);
      expect(w.range).toBeGreaterThan(0);
      expect(w.cooldown).toBeGreaterThan(0);
      expect(w.maxDurability).toBeGreaterThan(0);
      expect(w.arcCos).toBeGreaterThanOrEqual(-1);
      expect(w.arcCos).toBeLessThanOrEqual(1);
    }
  });

  it("every ranged weapon fully describes its projectile", () => {
    for (const w of Object.values(WEAPONS)) {
      if (w.kind !== "ranged") continue;
      expect(w.projectile, w.id).toBeTruthy();
      expect(w.projectileSpeed, w.id).toBeGreaterThan(0);
      expect(Number.isFinite(w.maxDurability), `${w.id} ammo must be finite`).toBe(true);
    }
  });

  it("pickup weapons never include fists or the starter sword", () => {
    expect(PICKUP_WEAPONS).not.toContain("fists");
    expect(PICKUP_WEAPONS).not.toContain("sword");
  });

  it("wears down by one per use and reports the breaking use", () => {
    // Reads maxDurability from the table rather than hardcoding it: a balance
    // pass on the chair used to redden this test for no real reason.
    const max = WEAPONS.chair.maxDurability;
    let w = freshWeapon("chair");
    for (let i = 0; i < max - 1; i++) {
      const r = degradeWeapon(w);
      expect(r.broke).toBe(false);
      w = r.weapon;
    }
    expect(w.durability).toBe(1);
    const last = degradeWeapon(w);
    expect(last.broke).toBe(true);
    // What replaces a broken weapon (empty slot → fists) is the slot logic's
    // call — the math just reports the wear.
    expect(last.weapon.id).toBe("chair");
    expect(last.weapon.durability).toBe(0);
  });

  it("fists never break", () => {
    let w = freshWeapon("fists");
    for (let i = 0; i < 1000; i++) {
      const r = degradeWeapon(w);
      expect(r.broke).toBe(false);
      w = r.weapon;
    }
    expect(w.id).toBe("fists");
  });
});

describe("armor absorption", () => {
  it("helmet soaks before armor, armor before hearts", () => {
    const gear: GearState = { helmet: 2, armor: 3 };
    const r = absorbDamage(gear, 1);
    expect(r.hpDamage).toBe(0);
    expect(r.gear.helmet).toBe(1);
    expect(r.gear.armor).toBe(3);
  });

  it("overflow cascades: helmet destroyed, armor dented, rest to hp", () => {
    const r = absorbDamage({ helmet: 1, armor: 2 }, 5);
    expect(r.destroyed).toEqual(["helmet", "armor"]);
    expect(r.gear.helmet).toBeUndefined();
    expect(r.gear.armor).toBeUndefined();
    expect(r.hpDamage).toBe(2);
  });

  it("no gear means full damage to hp", () => {
    const r = absorbDamage({}, 2);
    expect(r.hpDamage).toBe(2);
    expect(r.destroyed).toEqual([]);
  });

  it("boots never absorb", () => {
    expect(GEAR.boots.absorb).toBe(0);
    const r = absorbDamage({ boots: 99 }, 3);
    expect(r.hpDamage).toBe(3);
    expect(r.gear.boots).toBe(99);
  });

  it("is pure — the input gear object is not mutated", () => {
    const gear: GearState = { helmet: 3 };
    absorbDamage(gear, 2);
    expect(gear.helmet).toBe(3);
  });
});

describe("progression tiers for weapons and potions", () => {
  it("maps floors to appropriate 5-tier bands", () => {
    expect(tierForFloor(1)).toBe(1);
    expect(tierForFloor(5)).toBe(1);
    expect(tierForFloor(6)).toBe(2);
    expect(tierForFloor(10)).toBe(2);
    expect(tierForFloor(11)).toBe(3);
    expect(tierForFloor(15)).toBe(3);
    expect(tierForFloor(16)).toBe(4);
    expect(tierForFloor(20)).toBe(4);
    expect(tierForFloor(21)).toBe(5);
    expect(tierForFloor(50)).toBe(5);
  });

  it("tier 1 weapon pool contains only early weapons and excludes endgame weapons", () => {
    const t1 = weaponsForFloor(1);
    expect(t1).toEqual(["stick", "chair", "bow"]);
    expect(t1).not.toContain("mace");
    expect(t1).not.toContain("gun");
    expect(t1).not.toContain("greatsword");
    expect(t1).not.toContain("flamethrower");
    expect(t1).not.toContain("warhammer");
    expect(t1).not.toContain("wreckingball");
  });

  it("weapon pools progressively expand with depth", () => {
    expect(weaponsForFloor(6)).toContain("mace");
    expect(weaponsForFloor(6)).toContain("gun");
    expect(weaponsForFloor(6)).not.toContain("greatsword");

    expect(weaponsForFloor(11)).toContain("greatsword");
    expect(weaponsForFloor(11)).toContain("flamethrower");
    expect(weaponsForFloor(11)).not.toContain("warhammer");

    expect(weaponsForFloor(16)).toContain("warhammer");
    expect(weaponsForFloor(16)).not.toContain("wreckingball");

    expect(weaponsForFloor(21)).toContain("wreckingball");
    expect(weaponsForFloor(21).length).toBe(PICKUP_WEAPONS.length);
  });

  it("tier 1 potion pool contains basic power-ups and excludes endgame spells", () => {
    const p1 = potionsForFloor(1);
    expect(p1).toEqual(["gold", "haste"]);
    expect(p1).not.toContain("rage");
    expect(p1).not.toContain("freeze");
    expect(p1).not.toContain("shield");
    expect(p1).not.toContain("ballform");
    expect(p1).not.toContain("laser");
  });

  it("potion pools expand through tiers to mythic power-ups", () => {
    expect(potionsForFloor(6)).toContain("rage");
    expect(potionsForFloor(6)).toContain("freeze");
    expect(potionsForFloor(6)).not.toContain("shield");

    expect(potionsForFloor(11)).toContain("shield");
    expect(potionsForFloor(11)).toContain("magnetcore");
    expect(potionsForFloor(11)).not.toContain("ballform");

    expect(potionsForFloor(16)).toContain("ballform");
    expect(potionsForFloor(16)).toContain("multiball");
    expect(potionsForFloor(16)).not.toContain("laser");

    expect(potionsForFloor(21)).toContain("laser");
  });
});

