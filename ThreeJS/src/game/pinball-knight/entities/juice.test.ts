import { describe, it, expect, beforeEach } from "vitest";
import { state } from "../state";
import { requestShake, requestHitstop, tickJuice, resetJuice, juiceDebug } from "../engine/juice";
import { HITSTOP_MAX_PENDING, HITSTOP_MIN_GAP } from "../constants";

/** Put the governor and the juice fields back to a known cold start. */
function cold(): void {
  resetJuice();
  state.shakeT = 0;
  state.hitstopT = 0;
  // bounceCombo is per-PLAYER ride state, so the governor needs a player to
  // read it from. A bare stub is enough — chainFactor only touches this field.
  state.player = { bounceCombo: 0 } as unknown as NonNullable<typeof state.player>;
}

/** Set the live bounce-chain depth the governor damps against. */
function chain(depth: number): void {
  if (state.player) state.player.bounceCombo = depth;
}

describe("juice governor — a LONE hit is untouched", () => {
  beforeEach(cold);

  it("gives a single hitstop request exactly what it asked for", () => {
    // The contract that protects game feel: one bumper after a quiet moment
    // must crunch precisely as it did before the governor existed.
    requestHitstop(0.06);
    expect(state.hitstopT).toBeCloseTo(0.06, 5);
  });

  it("gives a single shake request exactly what it asked for", () => {
    requestShake(0.3);
    expect(state.shakeT).toBeCloseTo(0.3, 5);
  });

  it("still lets a BIGGER later hit raise a running shake", () => {
    requestShake(0.12);
    tickJuice(1); // well past any window
    requestShake(0.5); // a boss slam after a light tap
    expect(state.shakeT).toBeCloseTo(0.5, 5);
  });
});

describe("juice governor — chains are damped", () => {
  beforeEach(cold);

  it("drops a second hitstop inside the minimum gap", () => {
    // Two freezes closer together than the gap are one stutter, not two
    // crunches — this is the case that made fast play feel like lag.
    requestHitstop(0.06);
    state.hitstopT = 0; // pretend the first freeze elapsed
    tickJuice(HITSTOP_MIN_GAP * 0.4);
    requestHitstop(0.06);
    expect(state.hitstopT).toBe(0);
  });

  it("allows a hitstop again once the gap has passed", () => {
    requestHitstop(0.06);
    state.hitstopT = 0;
    tickJuice(HITSTOP_MIN_GAP * 1.5);
    requestHitstop(0.06);
    expect(state.hitstopT).toBeGreaterThan(0);
  });

  it("damps a deep bounce chain but never to silence", () => {
    chain(8); // mid-ricochet through a bumper cluster
    requestShake(0.3);
    // Damped...
    expect(state.shakeT).toBeLessThan(0.3);
    // ...but still audible. A hit that produces literally nothing reads as a
    // bug to the player, which is worse than the stutter being fixed.
    expect(state.shakeT).toBeGreaterThan(0);
  });

  it("damps progressively — deeper chain, weaker shake", () => {
    chain(2);
    requestShake(0.3);
    const shallow = state.shakeT;
    cold();
    chain(9);
    requestShake(0.3);
    expect(state.shakeT).toBeLessThan(shallow);
  });

  it("NEVER pauses the sim longer than the hard ceiling", () => {
    // The structural backstop: even a single absurd request cannot freeze the
    // world beyond the cap, so the pathological stack is impossible rather
    // than merely unlikely.
    requestHitstop(10);
    expect(state.hitstopT).toBeLessThanOrEqual(HITSTOP_MAX_PENDING);
  });

  it("a long rapid chain keeps the sim advancing", () => {
    // The regression that matters. Simulate 40 rapid part hits at 60fps and
    // assert the world is NOT frozen for most of that span — before the
    // governor, every one of these re-armed a freeze.
    let frozenFrames = 0;
    for (let i = 0; i < 40; i++) {
      chain(i);
      requestHitstop(0.06);
      requestShake(0.2);
      const dt = 1 / 60;
      tickJuice(dt);
      if (state.hitstopT > 0) {
        frozenFrames++;
        state.hitstopT = Math.max(0, state.hitstopT - dt);
      }
    }
    // Comfortably under half the frames frozen. The exact figure is not the
    // contract — "the sim keeps running during a chain" is.
    expect(frozenFrames).toBeLessThan(20);
  });
});

describe("juice governor — lifecycle", () => {
  beforeEach(cold);

  it("resets its clocks so a new floor starts cold", () => {
    requestHitstop(0.06);
    expect(juiceDebug().sinceHitstop).toBe(0);
    resetJuice();
    expect(juiceDebug().sinceHitstop).toBe(Infinity);
  });

  it("treats a fresh floor's first hit as a lone hit", () => {
    cold();
    chain(9);
    requestHitstop(0.06);
    resetJuice();
    state.hitstopT = 0;
    chain(0);
    requestHitstop(0.06);
    expect(state.hitstopT).toBeCloseTo(0.06, 5);
  });
});
