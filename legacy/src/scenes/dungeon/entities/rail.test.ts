import { describe, it, expect } from "vitest";
import {
  freshRail,
  holdStrength,
  holdsRail,
  stepRail,
  tryCatchRail,
  decayOverspeed,
  railCap,
} from "./rail";
import { PINBALL_MAX_SPEED, RAIL_GRACE, RAIL_MIN_SPEED, RAIL_OVERSPEED } from "../constants";

describe("holdStrength — you have to steer INTO the wall", () => {
  it("is full when input points straight at the bank", () => {
    expect(holdStrength(0, -1, 0, -1)).toBeCloseTo(1, 5);
  });

  it("is zero when input points away", () => {
    expect(holdStrength(0, 1, 0, -1)).toBe(0);
  });

  it("is zero with NO input — coasting must drop the rail", () => {
    // The core of "earn it": contact alone can never hold a rail. If this
    // returned anything positive the curve would carry a passive player, which
    // is a conveyor belt and explicitly not what was asked for.
    expect(holdStrength(0, 0, 0, -1)).toBe(0);
  });

  it("scales with how well the line is held", () => {
    const lazy = holdStrength(1, -1, 0, -1); // 45° lean
    const committed = holdStrength(0, -1, 0, -1); // straight in
    expect(lazy).toBeGreaterThan(0);
    expect(lazy).toBeLessThan(committed);
  });

  it("normalises input, so a bigger push is not a better hold", () => {
    // Analogue sticks and keyboards must feel the same. Only DIRECTION counts.
    expect(holdStrength(0, -9, 0, -1)).toBeCloseTo(holdStrength(0, -1, 0, -1), 5);
  });
});

describe("catching a rail", () => {
  it("catches when fast enough and holding", () => {
    const r = freshRail();
    expect(tryCatchRail(r, 3, 1, 12)).toBe(true);
    expect(r.featureIdx).toBe(3);
  });

  it("refuses below the speed floor — slow contact is just leaning on stone", () => {
    const r = freshRail();
    expect(tryCatchRail(r, 3, 1, RAIL_MIN_SPEED - 0.1)).toBe(false);
  });

  it("refuses without a hold, however fast", () => {
    const r = freshRail();
    expect(tryCatchRail(r, 3, 0, 22)).toBe(false);
  });

  it("does not re-catch while already riding", () => {
    const r = freshRail();
    tryCatchRail(r, 3, 1, 12);
    expect(tryCatchRail(r, 7, 1, 12)).toBe(false);
    expect(r.featureIdx).toBe(3);
  });
});

describe("stepRail — the ride", () => {
  const ride = () => {
    const r = freshRail();
    tryCatchRail(r, 1, 1, 12);
    return r;
  };

  it("accelerates while held", () => {
    const r = ride();
    const out = stepRail(r, true, 1, 12, 1 / 60);
    expect(out.riding).toBe(true);
    expect(out.speed).toBeGreaterThan(12);
  });

  it("EXCEEDS the normal speed cap — the whole point of the ride", () => {
    // "rail exceeds cap until you get off". Without this a long arc saturates
    // instantly and the ride stops reading as acceleration.
    const r = ride();
    let s = PINBALL_MAX_SPEED;
    for (let i = 0; i < 120; i++) s = stepRail(r, true, 1, s, 1 / 60).speed;
    expect(s).toBeGreaterThan(PINBALL_MAX_SPEED);
  });

  it("is still bounded — overspeed is a ceiling, not infinity", () => {
    const r = ride();
    let s = PINBALL_MAX_SPEED;
    for (let i = 0; i < 2000; i++) s = stepRail(r, true, 1, s, 1 / 60).speed;
    expect(s).toBeLessThanOrEqual(railCap() + 1e-6);
    expect(railCap()).toBeCloseTo(PINBALL_MAX_SPEED * RAIL_OVERSPEED, 5);
  });

  it("accelerates harder for a better-held line", () => {
    const a = ride();
    const b = ride();
    const lazy = stepRail(a, true, 0.4, 12, 1 / 60).speed;
    const committed = stepRail(b, true, 1, 12, 1 / 60).speed;
    expect(committed).toBeGreaterThan(lazy);
  });

  it("forgives a brief wobble inside the grace window", () => {
    // A long corner will always have a frame or two off the ideal line.
    // Dropping instantly would punish commitment instead of rewarding it.
    const r = ride();
    const out = stepRail(r, true, 0, 12, RAIL_GRACE * 0.5);
    expect(out.riding).toBe(true);
    expect(out.released).toBe(false);
  });

  it("drops you once the grace window elapses", () => {
    const r = ride();
    stepRail(r, true, 0, 12, RAIL_GRACE * 0.7);
    const out = stepRail(r, true, 0, 12, RAIL_GRACE * 0.7);
    expect(out.riding).toBe(false);
    expect(out.released).toBe(true);
    expect(r.featureIdx).toBe(-1);
  });

  it("drops you the instant contact is lost", () => {
    // Leaving the wall is unambiguous — no grace for that.
    const r = ride();
    const out = stepRail(r, false, 1, 12, 1 / 60);
    expect(out.riding).toBe(false);
    expect(out.released).toBe(true);
  });

  it("drops you if you slow below the floor", () => {
    const r = ride();
    const out = stepRail(r, true, 1, RAIL_MIN_SPEED - 0.5, 1 / 60);
    expect(out.released).toBe(true);
  });

  it("reports released exactly ONCE, not every frame after", () => {
    // Callers fire an exit flourish on `released`; repeating it would spam.
    const r = ride();
    stepRail(r, false, 1, 12, 1 / 60);
    const after = stepRail(r, false, 1, 12, 1 / 60);
    expect(after.released).toBe(false);
  });

  it("does nothing when not riding", () => {
    const r = freshRail();
    const out = stepRail(r, true, 1, 12, 1 / 60);
    expect(out.riding).toBe(false);
    expect(out.speed).toBe(12);
  });
});

describe("decayOverspeed — the reward is carried, not confiscated", () => {
  it("bleeds overspeed back toward the cap", () => {
    const fast = railCap();
    const after = decayOverspeed(fast, 0.5);
    expect(after).toBeLessThan(fast);
    expect(after).toBeGreaterThan(PINBALL_MAX_SPEED);
  });

  it("never falls below the normal cap", () => {
    expect(decayOverspeed(railCap(), 100)).toBe(PINBALL_MAX_SPEED);
  });

  it("leaves ordinary pinball speeds completely alone", () => {
    // This runs every frame for every player, railing or not. It must be a
    // no-op below the cap or it would quietly drag on all normal movement.
    expect(decayOverspeed(9, 1)).toBe(9);
    expect(decayOverspeed(PINBALL_MAX_SPEED, 1)).toBe(PINBALL_MAX_SPEED);
  });

  it("takes a real moment to bleed off — the exit is a payoff", () => {
    // If it decayed in a few frames the ride would be pointless. Assert the
    // carried speed survives long enough to spend on the next straight.
    let s = railCap();
    for (let i = 0; i < 12; i++) s = decayOverspeed(s, 1 / 60);
    expect(s).toBeGreaterThan(PINBALL_MAX_SPEED);
  });
});
