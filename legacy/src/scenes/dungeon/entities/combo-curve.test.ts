import { describe, it, expect } from "vitest";
import {
  comboSpeedCeil,
  comboCornerRestitution,
  comboCornerAdd,
  comboWindow,
  comboFrictionMul,
  comboKillGold,
  comboZone,
  frenzyIntensity,
} from "./combo-curve";
import {
  PINBALL_MAX_SPEED,
  PINBALL_CORNER_RESTITUTION,
  PINBALL_CORNER_ADD,
  COMBO_CEIL_BASE,
  COMBO_CEIL_NSAT,
  COMBO_WINDOW_MAX,
  COMBO_WINDOW_MIN,
  COMBO_ZONE_CRUISE,
  COMBO_ZONE_FRENZY,
  STYLE_KILL_BASE_GOLD,
} from "../constants";

describe("combo speed ceiling (Part 1)", () => {
  it("starts at base and is concave up to the cap", () => {
    expect(comboSpeedCeil(0)).toBeCloseTo(COMBO_CEIL_BASE, 6);
    // Monotonic increasing.
    let prev = -Infinity;
    for (let n = 0; n <= 200; n++) {
      const v = comboSpeedCeil(n);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(PINBALL_MAX_SPEED + 1e-9);
      prev = v;
    }
  });
  it("reaches ~95% of the cap by Nsat and never exceeds it", () => {
    const at = comboSpeedCeil(COMBO_CEIL_NSAT);
    const frac = (at - COMBO_CEIL_BASE) / (PINBALL_MAX_SPEED - COMBO_CEIL_BASE);
    expect(frac).toBeGreaterThan(0.9);
    expect(frac).toBeLessThan(1.0001);
    expect(comboSpeedCeil(1e6)).toBeLessThanOrEqual(PINBALL_MAX_SPEED + 1e-9);
  });
  it("rewards early combos disproportionately (concavity)", () => {
    const early = comboSpeedCeil(4) - comboSpeedCeil(0);
    const late = comboSpeedCeil(44) - comboSpeedCeil(40);
    expect(early).toBeGreaterThan(late);
  });
});

describe("restitution taper (Part 3)", () => {
  it("peaks at combo 0 and decays toward speed-neutral", () => {
    expect(comboCornerRestitution(0)).toBeCloseTo(PINBALL_CORNER_RESTITUTION, 6);
    expect(comboCornerAdd(0)).toBeCloseTo(PINBALL_CORNER_ADD, 6);
    expect(comboCornerRestitution(50)).toBeLessThan(1.01);
    expect(comboCornerRestitution(50)).toBeGreaterThanOrEqual(1);
    expect(comboCornerAdd(30)).toBeLessThan(0.3);
    // Both strictly decreasing.
    for (let n = 1; n <= 100; n++) {
      expect(comboCornerRestitution(n)).toBeLessThan(comboCornerRestitution(n - 1));
      expect(comboCornerAdd(n)).toBeLessThan(comboCornerAdd(n - 1));
    }
  });
});

describe("combo window (Part 4)", () => {
  it("shrinks from max toward min", () => {
    expect(comboWindow(0)).toBeCloseTo(COMBO_WINDOW_MAX, 6);
    expect(comboWindow(1e6)).toBeCloseTo(COMBO_WINDOW_MIN, 6);
    for (let n = 1; n <= 80; n++) expect(comboWindow(n)).toBeLessThan(comboWindow(n - 1));
    // Never below the floor.
    for (let n = 0; n <= 500; n++) expect(comboWindow(n)).toBeGreaterThanOrEqual(COMBO_WINDOW_MIN - 1e-9);
  });
});

describe("combo friction (Part 5)", () => {
  it("is 1.0 at combo 0 and rises gently", () => {
    expect(comboFrictionMul(0)).toBe(1);
    expect(comboFrictionMul(100)).toBeCloseTo(1.15, 6);
    expect(comboFrictionMul(100)).toBeLessThan(1.2); // stays gentle — no highway kill
  });
});

describe("kill gold tiers (Part 6)", () => {
  it("pays per doubling of the combo", () => {
    expect(comboKillGold(0)).toBe(STYLE_KILL_BASE_GOLD);
    expect(comboKillGold(1)).toBe(2);
    expect(comboKillGold(2)).toBe(5);
    expect(comboKillGold(3)).toBe(5);
    expect(comboKillGold(4)).toBe(8);
    expect(comboKillGold(8)).toBe(11);
    expect(comboKillGold(16)).toBe(14);
    expect(comboKillGold(32)).toBe(17);
    expect(comboKillGold(64)).toBe(20);
  });
  it("is monotonic and never explodes (log growth)", () => {
    for (let n = 1; n <= 1024; n++) expect(comboKillGold(n)).toBeGreaterThanOrEqual(comboKillGold(n - 1));
    expect(comboKillGold(1024)).toBeLessThan(40); // a huge combo is still bounded
  });
});

describe("tempo zones (Part 2)", () => {
  it("crosses at the thresholds", () => {
    expect(comboZone(0)).toBe("launch");
    expect(comboZone(COMBO_ZONE_CRUISE - 1)).toBe("launch");
    expect(comboZone(COMBO_ZONE_CRUISE)).toBe("cruise");
    expect(comboZone(COMBO_ZONE_FRENZY - 1)).toBe("cruise");
    expect(comboZone(COMBO_ZONE_FRENZY)).toBe("frenzy");
  });
  it("frenzy intensity eases in from 0 to 1", () => {
    expect(frenzyIntensity(COMBO_ZONE_FRENZY - 1)).toBe(0);
    expect(frenzyIntensity(COMBO_ZONE_FRENZY)).toBe(0);
    expect(frenzyIntensity(COMBO_ZONE_FRENZY + COMBO_ZONE_FRENZY)).toBe(1);
    expect(frenzyIntensity(1e6)).toBe(1);
  });
});
