/**
 * Rate limiting — the shared replacement for three hand-rolled guards, two of
 * which were wrong.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let clock = 0;

vi.mock("../../../utils/audio-manager", () => ({
  // The gate keys on the AUDIO clock, not performance.now(), so the gate and the
  // scheduling share one timebase and a suspended context does not burn budget.
  getAudioCtx: () => ({ currentTime: clock }),
  getSfxMaster: () => null,
  setMasterVolume: () => {},
}));

const { gate, voice, resetGates } = await import("./gate");

beforeEach(() => {
  clock = 0;
  resetGates();
});

describe("gate", () => {
  it("passes the FIRST call", () => {
    // Load-bearing: a gate that swallows its first hit makes the one-shot case
    // silent, which is the bug it exists to prevent. The fire vent burns you once
    // and must be heard once.
    expect(gate("vent", 0.3)).toBe(true);
  });

  it("blocks until the gap has elapsed, then passes again", () => {
    expect(gate("k", 0.5)).toBe(true);
    clock = 0.2;
    expect(gate("k", 0.5)).toBe(false);
    clock = 0.49;
    expect(gate("k", 0.5)).toBe(false);
    clock = 0.51;
    expect(gate("k", 0.5)).toBe(true);
  });

  it("keys are independent", () => {
    expect(gate("a", 10)).toBe(true);
    expect(gate("b", 10)).toBe(true);
    expect(gate("a", 10)).toBe(false);
  });

  it("does not advance its own clock when blocked", () => {
    // A gate that refreshed its timestamp on a REJECTED call would never open
    // again under continuous pressure — the rail rumble would go permanently
    // silent while you were riding, which is exactly when it should sound.
    expect(gate("k", 1)).toBe(true);
    for (let t = 0.1; t < 1; t += 0.1) {
      clock = t;
      gate("k", 1);
    }
    clock = 1.01;
    expect(gate("k", 1)).toBe(true);
  });
});

describe("voice", () => {
  it("hands out indices up to the cap, then refuses", () => {
    // An INDEX, not a boolean, because the caller uses it musically: the coin
    // sting walks a pitch ladder by index so a sweep of coins is an arpeggio
    // rather than twelve copies of one note stacking into a buzz.
    expect(voice("coin", 3, 0.35)).toBe(0);
    expect(voice("coin", 3, 0.35)).toBe(1);
    expect(voice("coin", 3, 0.35)).toBe(2);
    expect(voice("coin", 3, 0.35)).toBe(-1);
    expect(voice("coin", 3, 0.35)).toBe(-1);
  });

  it("starts a fresh cluster after a quiet gap", () => {
    voice("coin", 2, 0.3);
    voice("coin", 2, 0.3);
    expect(voice("coin", 2, 0.3)).toBe(-1);
    clock = 1.0; // quiet long enough
    expect(voice("coin", 2, 0.3)).toBe(0);
  });

  it("a continuous stream keeps the cluster open rather than resetting mid-sweep", () => {
    // The window is measured from the LAST call, not the first: coins arriving
    // steadily are one cluster, so the ladder keeps climbing instead of
    // restarting from the root every 0.3s.
    expect(voice("c", 5, 0.3)).toBe(0);
    clock = 0.2;
    expect(voice("c", 5, 0.3)).toBe(1);
    clock = 0.4;
    expect(voice("c", 5, 0.3)).toBe(2);
  });

  it("resetGates clears both gates and clusters", () => {
    gate("k", 100);
    voice("c", 1, 100);
    resetGates();
    expect(gate("k", 100)).toBe(true);
    expect(voice("c", 1, 100)).toBe(0);
  });
});
