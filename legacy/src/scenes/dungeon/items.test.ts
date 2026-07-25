import { describe, it, expect } from "vitest";
import { WEAPONS, PICKUP_WEAPONS, freshWeapon, degradeWeapon, absorbDamage, GEAR, type GearState } from "./items";

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
