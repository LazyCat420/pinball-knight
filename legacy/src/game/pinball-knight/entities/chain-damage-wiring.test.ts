/**
 * Proves the Part 7 chain multiplier actually reaches playerDamage — the unit
 * tests cover the CURVE, this covers the WIRING. A correct curve that is never
 * called would pass every other test in the suite.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { playerDamage } from "./combat";
import { state } from "../state";
import { comboDamageMult } from "./combo-curve";
import { COMBO_ZONE_CRUISE } from "../constants";

describe("chain damage is wired into playerDamage", () => {
  beforeEach(() => {
    state.weaponSlots = [null, null];
    state.activeSlot = 0;
    state.player = {
      x: 0, z: 0, hp: 6, momSpeed: 0, bounceCombo: 0, rageT: 0,
      material: null, materialT: 0, boltCdT: 0, venomCoatT: 0, staticT: 0,
    } as unknown as typeof state.player;
  });

  it("does not change damage at or below the Cruise gate", () => {
    const p = state.player!;
    p.bounceCombo = 0;
    const base = playerDamage(10);
    p.bounceCombo = COMBO_ZONE_CRUISE;
    expect(playerDamage(10)).toBeCloseTo(base, 6);
  });

  it("scales damage by exactly comboDamageMult past the gate", () => {
    const p = state.player!;
    p.bounceCombo = 0;
    const base = playerDamage(10);
    for (const n of [12, 30, 60, 200]) {
      p.bounceCombo = n;
      expect(playerDamage(10)).toBeCloseTo(base * comboDamageMult(n), 6);
    }
  });

  it("a deep chain hits harder than a shallow one", () => {
    const p = state.player!;
    p.bounceCombo = 9;
    const shallow = playerDamage(10);
    p.bounceCombo = 80;
    expect(playerDamage(10)).toBeGreaterThan(shallow);
  });
});
