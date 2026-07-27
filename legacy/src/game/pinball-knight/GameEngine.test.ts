/**
 * The fixed-step clock. Each test here pins a rule that used to live inline in
 * core.ts's RAF callback, where it could not be exercised without a browser.
 */
import { describe, it, expect } from "vitest";
import { FixedStepLoop } from "./GameEngine";
import { FIXED_STEP, MAX_FRAME } from "./constants";

const loop = () => new FixedStepLoop({ fixedStep: FIXED_STEP, maxFrame: MAX_FRAME });

/** Run one frame with a no-op sim, returning the result. */
function tick(l: FixedStepLoop, delta: number, hitstop = 0) {
  return l.step(delta, hitstop, () => {});
}

describe("FixedStepLoop — stepping", () => {
  it("runs exactly one step for exactly one step's worth of time", () => {
    expect(tick(loop(), FIXED_STEP).simSteps).toBe(1);
  });

  it("runs no steps when less than a step has elapsed", () => {
    expect(tick(loop(), FIXED_STEP * 0.5).simSteps).toBe(0);
  });

  it("banks the remainder rather than dropping it", () => {
    const l = loop();
    // Two half-steps must add up to one step, or the sim would run slow.
    expect(tick(l, FIXED_STEP * 0.6).simSteps).toBe(0);
    expect(tick(l, FIXED_STEP * 0.6).simSteps).toBe(1);
  });

  it("catches up with multiple steps after a slow frame", () => {
    expect(tick(loop(), FIXED_STEP * 3).simSteps).toBe(3);
  });

  it("passes the FIXED step to the sim, never the real frame time", () => {
    // The whole point of a fixed timestep: physics must never see a variable dt.
    const seen: number[] = [];
    loop().step(FIXED_STEP * 2.5, 0, (dt) => seen.push(dt));
    expect(seen).toEqual([FIXED_STEP, FIXED_STEP]);
  });
});

describe("FixedStepLoop — delta clamping", () => {
  it("clamps a long frame to MAX_FRAME (tab-out protection)", () => {
    // A 10-second background tab must not spin the sim for 600 steps.
    const l = loop();
    const r = tick(l, 10);
    expect(r.frame).toBe(MAX_FRAME);
    expect(r.simSteps).toBeLessThanOrEqual(Math.ceil(MAX_FRAME / FIXED_STEP));
  });

  it("floors a NEGATIVE delta at zero", () => {
    // Guards a first RAF timestamp that lags performance.now(): one negative
    // delta would otherwise leave the accumulator negative and freeze the sim.
    const l = loop();
    expect(tick(l, -5).frame).toBe(0);
    expect(l.accumulator).toBe(0);
    // And the loop still works normally afterwards — it is not poisoned.
    expect(tick(l, FIXED_STEP).simSteps).toBe(1);
  });
});

describe("FixedStepLoop — hit-freeze", () => {
  it("runs no sim steps while frozen", () => {
    const r = tick(loop(), FIXED_STEP * 2, 0.05);
    expect(r.frozen).toBe(true);
    expect(r.simSteps).toBe(0);
  });

  it("bleeds the freeze down in REAL time", () => {
    const r = tick(loop(), 0.02, 0.05);
    expect(r.hitstopT).toBeCloseTo(0.03, 5);
  });

  it("never drives the remaining freeze below zero", () => {
    expect(tick(loop(), 1, 0.05).hitstopT).toBe(0);
  });

  it("does NOT bank time during a freeze, so the world cannot fast-forward", () => {
    // The bug this prevents: freeze for 500ms, then the instant it lifts the
    // accumulator cashes in 30 steps at once and the world teleports.
    const l = loop();
    tick(l, 0.5, 0.05);
    expect(l.accumulator).toBeLessThanOrEqual(FIXED_STEP);
    expect(tick(l, 0).simSteps).toBeLessThanOrEqual(1);
  });
});

describe("FixedStepLoop — reset", () => {
  it("drops banked time so a new floor starts clean", () => {
    const l = loop();
    tick(l, FIXED_STEP * 0.9);
    expect(l.accumulator).toBeGreaterThan(0);
    l.reset();
    expect(l.accumulator).toBe(0);
  });
});
