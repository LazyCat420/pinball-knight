import { describe, it, expect } from "vitest";
import { spinPadPhase, SPINPAD_SPIN_RATE } from "../constants";

/**
 * THE TURNTABLE. The spinpad used to fling the knight at `Math.random() * 2π`:
 * unaimable, unlearnable, and a live RNG draw sitting in a physics path that
 * co-op has to replay identically on every client.
 *
 * It is now a rotating deflector — it turns your entry heading by however far
 * the pad has spun — and these tests pin the two properties that makes it a
 * shot rather than a slot machine.
 */
describe("spinPadPhase — the deterministic turntable", () => {
  it("is a pure function of (elapsed, index)", () => {
    // The whole reason the RNG had to go: same inputs, same answer, forever.
    for (const [t, i] of [
      [0, 0],
      [1.5, 3],
      [97.25, 12],
    ] as const) {
      expect(spinPadPhase(t, i)).toBe(spinPadPhase(t, i));
    }
  });

  it("advances with time at the published rate", () => {
    // The renderer spins the rotor mesh off this same function, so if the rate
    // ever drifted from the physics the pad would be lying about its angle.
    expect(spinPadPhase(1, 0) - spinPadPhase(0, 0)).toBeCloseTo(SPINPAD_SPIN_RATE);
    expect(spinPadPhase(3, 5) - spinPadPhase(2, 5)).toBeCloseTo(SPINPAD_SPIN_RATE);
  });

  it("de-synchronises neighbouring pads without a random seed", () => {
    expect(spinPadPhase(0, 0)).not.toBeCloseTo(spinPadPhase(0, 1));
  });

  it("stays finite for any sane run length", () => {
    // A long run must not drift into a value that breaks cos/sin downstream.
    for (const t of [0, 60, 3600, 86400]) {
      const a = spinPadPhase(t, 7);
      expect(Number.isFinite(a)).toBe(true);
      expect(Number.isFinite(Math.cos(a))).toBe(true);
    }
  });

  it("a full rotation returns to the same deflection", () => {
    const period = (Math.PI * 2) / SPINPAD_SPIN_RATE;
    const a = spinPadPhase(10, 2);
    const b = spinPadPhase(10 + period, 2);
    expect(Math.cos(a)).toBeCloseTo(Math.cos(b));
    expect(Math.sin(a)).toBeCloseTo(Math.sin(b));
  });
});
