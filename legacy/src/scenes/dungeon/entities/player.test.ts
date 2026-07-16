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
