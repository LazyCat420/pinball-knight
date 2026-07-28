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
  comboDamageMult,
  momentumT,
  momentumScaled,
  momentumGate,
} from "./combo-curve";
import { PINBALL_MAX_SPEED as V_MAX, MOMENTUM_T_FLOOR } from "../constants";

describe("momentumT — the shared momentum ramp", () => {
  it("reads 0 at or below a walk and exactly 1 at terminal speed", () => {
    expect(momentumT(0)).toBe(0);
    expect(momentumT(MOMENTUM_T_FLOOR)).toBe(0);
    expect(momentumT(MOMENTUM_T_FLOOR - 3)).toBe(0);
    expect(momentumT(V_MAX)).toBeCloseTo(1);
  });

  it("never escapes [0,1], however absurd the input", () => {
    for (const v of [-1e6, -1, 0, 5, 22, 1e6]) {
      const t = momentumT(v);
      expect(Number.isFinite(t)).toBe(true);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(1);
    }
  });

  it("rises monotonically, so every extra unit of speed is worth something", () => {
    let prev = -1;
    for (let v = MOMENTUM_T_FLOOR; v <= V_MAX; v += 0.5) {
      const t = momentumT(v);
      expect(t).toBeGreaterThan(prev);
      prev = t;
    }
  });

  it("is CONCAVE — the first half of the speed range buys more than the second", () => {
    const mid = (MOMENTUM_T_FLOOR + V_MAX) / 2;
    expect(momentumT(mid)).toBeGreaterThan(0.5);
  });

  it("replaces the old cliff: the former gate speed is a partial, not a binary", () => {
    // The whole point of the wave. 8 u/s used to award 100% of every momentum
    // multiplier and 7.9 awarded 0%.
    const t = momentumT(8);
    expect(t).toBeGreaterThan(0.4);
    expect(t).toBeLessThan(0.8);
  });

  it("momentumScaled is neutral at a walk and full at terminal speed", () => {
    expect(momentumScaled(2, MOMENTUM_T_FLOOR)).toBeCloseTo(1);
    expect(momentumScaled(2, V_MAX)).toBeCloseTo(2);
    expect(momentumScaled(1, V_MAX)).toBe(1); // a 1× multiplier stays 1×
  });
});

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
  COMBO_DMG_MAX,
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

describe("chain damage multiplier (Part 7)", () => {
  it("is exactly 1.0 at and below the Cruise gate — early combat is untouched", () => {
    expect(comboDamageMult(0)).toBe(1);
    expect(comboDamageMult(1)).toBe(1);
    expect(comboDamageMult(COMBO_ZONE_CRUISE - 1)).toBe(1);
    expect(comboDamageMult(COMBO_ZONE_CRUISE)).toBe(1);
  });

  it("rises once past the gate", () => {
    expect(comboDamageMult(COMBO_ZONE_CRUISE + 1)).toBeGreaterThan(1);
  });

  it("never decreases", () => {
    for (let n = 1; n <= 512; n++) {
      expect(comboDamageMult(n)).toBeGreaterThanOrEqual(comboDamageMult(n - 1));
    }
  });

  it("saturates at COMBO_DMG_MAX and never exceeds it", () => {
    // The cap is the whole design: a free bonus must never rival an invested
    // pinballMult build. An unbounded curve here would silently do exactly that.
    for (const n of [100, 1000, 1e6]) {
      expect(comboDamageMult(n)).toBeLessThanOrEqual(COMBO_DMG_MAX + 1e-9);
    }
    expect(comboDamageMult(1e6)).toBeCloseTo(COMBO_DMG_MAX, 6);
  });

  it("is CONCAVE — each extra bounce is worth less than the last", () => {
    // Mastery should taper, not cliff. A linear ramp would make deep chains a
    // damage wall rather than a reward.
    let prevStep = Infinity;
    for (let n = COMBO_ZONE_CRUISE + 1; n < 80; n++) {
      const step = comboDamageMult(n + 1) - comboDamageMult(n);
      expect(step).toBeLessThanOrEqual(prevStep + 1e-9);
      prevStep = step;
    }
  });

  it("handles junk input without going negative or NaN", () => {
    expect(comboDamageMult(-5)).toBe(1);
    expect(Number.isFinite(comboDamageMult(0))).toBe(true);
  });
});

describe("momentumGate — the enemy gates as curves (DECLONE §6.2)", () => {
  const PINBALL_MAX_SPEED = V_MAX;
  const BAR = 12; // stand-in for SECRET_BREAK_SPEED

  it("is 0 at a standstill and 1 at terminal speed", () => {
    expect(momentumGate(0, BAR, 0.25)).toBe(0);
    expect(momentumGate(PINBALL_MAX_SPEED, BAR, 0.25)).toBeCloseTo(1, 6);
  });

  it("passes through EXACTLY `soft` at the old binary bar", () => {
    // The whole point: the bar survives as a landmark instead of a wall.
    for (const soft of [0, 0.1, 0.25, 0.5]) {
      expect(momentumGate(BAR, BAR, soft)).toBeCloseTo(soft, 6);
    }
  });

  it("is monotone — every extra unit of speed still pays, above AND below", () => {
    let prev = -1;
    for (let v = 0; v <= PINBALL_MAX_SPEED; v += 0.1) {
      const f = momentumGate(v, BAR, 0.25);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });

  it("soft=0 reproduces the OLD WALL exactly (nothing below the bar)", () => {
    // Documents that the cliff is still expressible — the change is a knob, not
    // a removal, so a monster that genuinely wants a wall can still have one.
    expect(momentumGate(BAR - 0.01, BAR, 0)).toBeCloseTo(0, 6);
    expect(momentumGate(BAR + 0.01, BAR, 0)).toBeGreaterThan(0);
  });

  it("a gate AT the walk floor LIFTS the ramp to start at `soft`", () => {
    // The goblin's rule was only ever "carry SOME speed" — never "exceed
    // walking speed" — so a bar with no knee to place must not re-impose one.
    //
    // The first version returned the bare ramp here, which is 0 below
    // MOMENTUM_T_FLOOR, and quietly made goblins near-immortal to anything
    // slower than a sprint. A headless soak found it as the bot being
    // ping-ponged in a corner by something it could not kill: 6/13 runs
    // reporting a stuck episode against 1/9 on the baseline.
    for (const v of [0, 5, 8, 14, 22]) {
      expect(momentumGate(v, MOMENTUM_T_FLOOR, 0.25)).toBeCloseTo(0.25 + 0.75 * momentumT(v), 6);
    }
    // Half damage the instant you are moving at all; full at terminal.
    expect(momentumGate(1, MOMENTUM_T_FLOOR, 0.5)).toBeCloseTo(0.5, 6);
    expect(momentumGate(PINBALL_MAX_SPEED, MOMENTUM_T_FLOOR, 0.5)).toBeCloseTo(1, 6);
    // soft = 0 still gives the bare ramp, so the old shape stays expressible.
    for (const v of [0, 8, 22]) expect(momentumGate(v, MOMENTUM_T_FLOOR, 0)).toBeCloseTo(momentumT(v), 6);
  });

  it("stays in [0,1] for nonsense inputs", () => {
    for (const v of [-5, 0, 22, 1000]) {
      for (const g of [-1, 0, 12, 22, 100]) {
        const f = momentumGate(v, g, 0.25);
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThanOrEqual(1);
      }
    }
  });

  it("MEASURED: the old gate is flat above the bar; this one is not", () => {
    // The failure DECLONE §0 named — "fully switched on at 36% of top speed and
    // gains nothing above it". Old gate: 1 at both 12 and 22. New: a real gap.
    const atBar = momentumGate(BAR, BAR, 0.25);
    const atTop = momentumGate(PINBALL_MAX_SPEED, BAR, 0.25);
    expect(atTop - atBar).toBeGreaterThan(0.6);
  });
});
