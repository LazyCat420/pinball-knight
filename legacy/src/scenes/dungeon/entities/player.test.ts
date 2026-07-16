/**
 * Pure-logic tests for the movement/combat additions: the stamina economy and
 * the dodge-roll's distance/i-frame math. Rendering is not tested (house rule) —
 * these cover the numbers that gameplay balance depends on.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { state, freshPlayerFields } from "../state";
import { spendStamina } from "./player";
import {
  STAMINA_MAX,
  DODGE_COST,
  ROLL_DISTANCE,
  ROLL_DURATION,
  ROLL_IFRAMES,
  PLAYER_IFRAMES,
  LIGHT_1,
  LIGHT_2,
  COMBO_FINISH,
  HEAVY,
  COMBO_WINDOW,
  CHARGE_TIME,
  HEAVY_COST,
  SPRINT_RAMP_TIME,
  SPRINT_DECAY_TIME,
  SPRINT_RIDE_THRESHOLD,
  SPRINT_SPEED_MULT,
  WALLKICK,
  WALLKICK_IFRAMES,
  WALLKICK_DURATION,
  WALLRIDE,
  POUNCE,
  POUNCE_IFRAMES,
  POUNCE_DURATION,
} from "../constants";

/** A bare player stub — the fields spendStamina + the roll math read. */
function stubPlayer(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state.player = { x: 0, z: 0, ...freshPlayerFields() } as any;
}

describe("stamina", () => {
  beforeEach(stubPlayer);

  it("starts full", () => {
    expect(state.player!.stamina).toBe(STAMINA_MAX);
  });

  it("spend deducts and pauses regen, and refuses when short", () => {
    expect(spendStamina(DODGE_COST)).toBe(true);
    expect(state.player!.stamina).toBeCloseTo(STAMINA_MAX - DODGE_COST);
    expect(state.player!.staminaRegenDelay).toBeGreaterThan(0);

    // Drain to below one dodge, then a dodge must be refused (no partial spend).
    state.player!.stamina = DODGE_COST - 1;
    const before = state.player!.stamina;
    expect(spendStamina(DODGE_COST)).toBe(false);
    expect(state.player!.stamina).toBe(before); // unchanged on a refused spend
  });

  it("a full bar buys ~3 dodges but not 4", () => {
    let dodges = 0;
    while (spendStamina(DODGE_COST)) dodges++;
    expect(dodges).toBe(Math.floor(STAMINA_MAX / DODGE_COST));
    expect(dodges).toBe(3);
  });
});

describe("dodge-roll math", () => {
  it("the eased velocity profile covers exactly ROLL_DISTANCE", () => {
    // v(tau) = v0 * (1 - tau); integral over the roll = v0 * DURATION / 2.
    // With v0 = 2*DIST/DURATION that integral is exactly DIST. Verify by
    // numeric integration (matches how player.ts steps it each frame).
    const v0 = (2 * ROLL_DISTANCE) / ROLL_DURATION;
    const steps = 600;
    const dt = ROLL_DURATION / steps;
    let dist = 0;
    for (let i = 0; i < steps; i++) {
      const tau = (i * dt) / ROLL_DURATION;
      dist += v0 * (1 - tau) * dt;
    }
    expect(dist).toBeCloseTo(ROLL_DISTANCE, 1);
  });

  it("i-frames cover only the front half of the roll, never the whole thing", () => {
    // The verified Gungeon rule: partial coverage. Front window < full roll.
    expect(ROLL_IFRAMES).toBeGreaterThan(0);
    expect(ROLL_IFRAMES).toBeLessThan(ROLL_DURATION);
    expect(ROLL_IFRAMES / ROLL_DURATION).toBeLessThan(0.6); // ~52%, not all of it
  });

  it("roll i-frames never exceed the damage-hit i-frame window (no double-stack)", () => {
    // The single-guard fix tops up p.iframes to at most (ROLL_IFRAMES - rollT).
    // That peak (at rollT=0) must not exceed the normal damage i-frames, or a
    // roll would grant a LONGER invuln than getting hit — the stacking bug.
    expect(ROLL_IFRAMES).toBeLessThanOrEqual(PLAYER_IFRAMES);
  });
});

describe("melee move timings", () => {
  const total = (m: typeof LIGHT_1) => m.windup + m.active + m.recovery;

  it("windup scales with weight: light < finisher < heavy", () => {
    expect(LIGHT_1.windup).toBeLessThan(COMBO_FINISH.windup);
    expect(COMBO_FINISH.windup).toBeLessThan(HEAVY.windup);
  });

  it("damage scales up the chain, heavy hits hardest", () => {
    expect(LIGHT_1.damageMul).toBeLessThanOrEqual(LIGHT_2.damageMul);
    expect(LIGHT_2.damageMul).toBeLessThan(COMBO_FINISH.damageMul);
    expect(COMBO_FINISH.damageMul).toBeLessThan(HEAVY.damageMul);
  });

  it("only heavy costs stamina; light swings are free", () => {
    expect(LIGHT_1.staminaCost).toBe(0);
    expect(LIGHT_2.staminaCost).toBe(0);
    expect(COMBO_FINISH.staminaCost).toBe(0);
    expect(HEAVY.staminaCost).toBe(HEAVY_COST);
  });

  it("a light chain can link: the combo window outlasts a light's recovery", () => {
    // The verified rule: a link is possible only if the follow-up can be pressed
    // before the chain closes. The window must at least cover a light's recovery
    // so a natural double-tap during recovery chains.
    expect(COMBO_WINDOW).toBeGreaterThan(LIGHT_1.recovery);
  });

  it("charge threshold sits above a light's full duration (a tap can't accidentally heavy)", () => {
    expect(CHARGE_TIME).toBeGreaterThan(total(LIGHT_1));
  });
});

describe("sprint ramp (the 3-second spool-up)", () => {
  it("reaches full charge in ~SPRINT_RAMP_TIME and gates the wall-ride at halfway", () => {
    // Charge integrates dt/RAMP each frame; after RAMP_TIME of holding it's full.
    let c = 0;
    const dt = 1 / 60;
    for (let t = 0; t < SPRINT_RAMP_TIME; t += dt) c = Math.min(1, c + dt / SPRINT_RAMP_TIME);
    expect(c).toBeCloseTo(1, 2);
    // The 3s ask, and the >50% ride gate reached at ~half the ramp.
    expect(SPRINT_RAMP_TIME).toBeCloseTo(3, 5);
    expect(SPRINT_RIDE_THRESHOLD).toBe(0.5);
  });

  it("the ride threshold is crossed strictly before full sprint (ride ⊂ sprinting)", () => {
    // At the threshold you are past walk but not yet at top speed — a real 'fast
    // enough' gate rather than 'must be maxed'.
    expect(SPRINT_RIDE_THRESHOLD).toBeGreaterThan(0);
    expect(SPRINT_RIDE_THRESHOLD).toBeLessThan(1);
    const speedAtRide = 1 + (SPRINT_SPEED_MULT - 1) * SPRINT_RIDE_THRESHOLD;
    expect(speedAtRide).toBeGreaterThan(1); // faster than a walk
    expect(speedAtRide).toBeLessThan(SPRINT_SPEED_MULT); // not yet full sprint
  });

  it("charge decays faster than it builds (a stumble kills sprint, a run must be earned)", () => {
    expect(SPRINT_DECAY_TIME).toBeLessThan(SPRINT_RAMP_TIME);
  });
});

describe("wall moves (Mortal-Kombat specials off a wall)", () => {
  it("wall-kick i-frames cover only the front of the launch, never the whole hop", () => {
    expect(WALLKICK_IFRAMES).toBeGreaterThan(0);
    expect(WALLKICK_IFRAMES).toBeLessThan(WALLKICK_DURATION);
    // ...and never longer than a damage-hit's i-frames (the no-double-stack rule).
    expect(WALLKICK_IFRAMES).toBeLessThanOrEqual(PLAYER_IFRAMES);
  });

  it("pounce is airborne (untouchable) for most of its arc but is still finite", () => {
    expect(POUNCE_IFRAMES).toBeGreaterThan(WALLKICK_IFRAMES); // a bigger commit, more invuln
    expect(POUNCE_IFRAMES).toBeLessThanOrEqual(POUNCE_DURATION);
    expect(POUNCE_IFRAMES).toBeLessThanOrEqual(PLAYER_IFRAMES);
  });

  it("every wall move is 'meaningful but costed': >1x damage AND a stamina price", () => {
    for (const m of [WALLKICK, WALLRIDE, POUNCE]) {
      expect(m.damageMul).toBeGreaterThan(1); // hits harder than a plain light
      expect(m.staminaCost).toBeGreaterThan(0); // never free
    }
    // The pounce is the biggest hammer of the three.
    expect(POUNCE.damageMul).toBeGreaterThan(WALLKICK.damageMul);
    expect(POUNCE.damageMul).toBeGreaterThan(WALLRIDE.damageMul);
    // The wall-ride sweeps the widest arc (it's the crowd-clearing slide).
    expect(WALLRIDE.arcMul).toBeGreaterThan(WALLKICK.arcMul);
  });
});
