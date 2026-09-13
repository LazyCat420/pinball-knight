/**
 * TILT TITAN SPIN CADENCE — the rate schedule, and the aliasing budget.
 *
 * The user reported the ball "spinning really slow" three separate times, and
 * three previous attempts answered by rebuilding the ART. None of them changed
 * the playback rate, which is where the speed actually lives — `git show
 * be6c68be^` puts the old sheet at 12 cells with no beats (1.000 s/loop) and
 * the new one at 32 cells with beats 12 (1.000 s/loop): a delta of exactly
 * zero. These tests exist so that cannot happen silently again.
 *
 * Everything here asserts a PROPERTY derived from the tuning constants, never
 * a hardcoded rate — retuning `PINBALL_SPIN` must not turn the suite red for
 * having been retuned. What must stay true is the SHAPE: the floor is real,
 * the launch never decelerates, all three clips read alike, and nothing is
 * pushed past the point where the bake boils.
 */
import { describe, expect, it, vi } from "vitest";
import { BOSSES } from "./boss-kinds";
import type { MoveCtx } from "./boss-moves";
import { freshPinballCharge, updatePinballCharge } from "./boss-moves";
import {
  PINBALL_AMBIENT_CLIP,
  PINBALL_SPIN,
  SPIN_TURNS_PER_LOOP,
  cellsPerDisplayedFrame,
  pinballPeakRevs,
  spinRate,
  type PinballSpinClip,
} from "./pinball-spin";

const CLIPS: PinballSpinClip[] = ["attack", "roll", "ball"];

/** One `setAnimRate` call, tagged with the phase and clip that produced it. */
interface RateSample { phase: string; clip: PinballSpinClip; rate: number }

/** A MoveCtx that records every rate the charge asks for, with its context. */
function recordingCtx(
  samples: RateSample[],
  rt: { phase: string; spinClip: PinballSpinClip },
  overrides: Partial<MoveCtx> = {},
): MoveCtx {
  return {
    dt: 0.05,
    x: 5,
    z: 5,
    target: { x: 15, z: 5 },
    grid: null,
    bodyR: 1.2,
    hitAt: vi.fn(),
    moveTo: vi.fn(),
    setFacing: vi.fn(),
    playAnim: vi.fn(),
    rotateSprite: vi.fn(),
    setHoldMovement: vi.fn(),
    setAnimRate: (rate: number) => { samples.push({ phase: rt.phase, clip: rt.spinClip, rate }); },
    ...overrides,
  } as MoveCtx;
}

/**
 * Drive idle -> telegraph -> running and collect every rate.
 *
 * The charge PICKS its own clip on entering the telegraph and keeps it for the
 * whole charge, so the test reads the clip back rather than forcing one —
 * overriding it mid-ramp changes the gain mid-charge and manufactures a
 * discontinuity the real game never has. `pick` steers the RNG so all three
 * clips get covered.
 */
function driveCharge(pick: number): { samples: RateSample[]; clip: PinballSpinClip } {
  const spec = BOSSES.pinball_boss.moves.pinballCharge!;
  const rt = freshPinballCharge(spec);
  const samples: RateSample[] = [];
  const ctx = recordingCtx(samples, rt);
  const random = vi.spyOn(Math, "random").mockReturnValue(pick);
  try {
    rt.t = rt.telegraphDur + 1;
    updatePinballCharge(rt, spec, ctx); // an idle frame, for the ambient rate
    rt.t = rt.telegraphDur;
    updatePinballCharge(rt, spec, ctx); // transition into the telegraph
    let guard = 0;
    while (rt.phase !== "running" && guard++ < 500) updatePinballCharge(rt, spec, ctx);
    expect(rt.phase, "the charge must reach running").toBe("running");
    for (let i = 0; i < 3; i++) updatePinballCharge(rt, spec, ctx);
  } finally {
    random.mockRestore();
  }
  return { samples, clip: rt.spinClip };
}

/** Every distinct clip the weighted pool can yield, with an RNG value for each. */
function clipCases(): Array<{ pick: number; clip: PinballSpinClip }> {
  const seen = new Map<PinballSpinClip, number>();
  for (const pick of [0, 0.2, 0.3, 0.45, 0.6, 0.75, 0.85, 0.95]) {
    const { clip } = driveCharge(pick);
    if (!seen.has(clip)) seen.set(clip, pick);
  }
  return [...seen].map(([clip, pick]) => ({ clip, pick }));
}

describe("surface speed, not loop speed", () => {
  it("gives every clip the SAME surface rev/s despite different axis paths", () => {
    // One baked loop is one loop for all three, but `roll` and `ball` sweep a
    // full turn about TWO axes — so a single shared rate made the identical
    // charge read up to 51% faster or slower depending only on which path the
    // RNG drew. Gain-correction is the whole point of the table.
    const target = 6.0;
    const surface = CLIPS.map((c) => spinRate(c, target) * SPIN_TURNS_PER_LOOP[c]);
    for (const s of surface) expect(s).toBeCloseTo(target, 6);
  });

  it("the gains are actually different, or the correction is a no-op", () => {
    // Guards against someone "simplifying" the table to all-1.0, which would
    // silently restore the spread this fix exists to remove.
    const spread = Math.max(...CLIPS.map((c) => SPIN_TURNS_PER_LOOP[c]))
      / Math.min(...CLIPS.map((c) => SPIN_TURNS_PER_LOOP[c]));
    expect(spread).toBeGreaterThan(1.2);
  });

  it("scales the peak with ground speed, and clamps at the aliasing ceiling", () => {
    const p1 = pinballPeakRevs(26);
    const p2 = pinballPeakRevs(30);
    expect(p2).toBeGreaterThan(p1);
    expect(pinballPeakRevs(999)).toBe(PINBALL_SPIN.max);
  });
});

describe("the rate schedule through a whole charge", () => {
  it("covers more than one clip, or the per-clip assertions prove nothing", () => {
    // A weighted pool that collapsed to a single clip would make every
    // gain-correction assertion below vacuously true.
    expect(clipCases().length).toBeGreaterThanOrEqual(2);
  });

  it("NEVER decelerates from the rev-up into the launch", () => {
    // The bug: the ramp ended at 3.5 and the release frame hard-coded 3.0, so
    // the ball slowed by 14% at the exact instant it fired.
    for (const { pick, clip } of clipCases()) {
      const { samples } = driveCharge(pick);
      const spinning = samples.filter((s) => s.phase !== "idle");
      expect(spinning.length, `${clip}: no telegraph/running frames recorded`).toBeGreaterThan(2);
      for (let i = 1; i < spinning.length; i++) {
        expect(
          spinning[i].rate,
          `${clip}: rate fell ${spinning[i - 1].rate.toFixed(3)} -> ${spinning[i].rate.toFixed(3)} at ${spinning[i].phase} step ${i}`,
        ).toBeGreaterThanOrEqual(spinning[i - 1].rate - 1e-9);
      }
    }
  });

  it("opens the rev-up at the floor, not at a standstill", () => {
    for (const { pick, clip } of clipCases()) {
      const { samples } = driveCharge(pick);
      const first = samples.find((s) => s.phase === "telegraph");
      expect(first, `${clip}: no telegraph frame`).toBeDefined();
      expect(
        first!.rate * SPIN_TURNS_PER_LOOP[first!.clip],
        `${clip}: the telegraph must open at the floor`,
      ).toBeGreaterThanOrEqual(PINBALL_SPIN.floor - 1e-6);
    }
  });

  it("dashes at the speed-scaled peak, in SURFACE rev/s, whichever clip it drew", () => {
    const spec = BOSSES.pinball_boss.moves.pinballCharge!;
    for (const { pick, clip } of clipCases()) {
      const { samples } = driveCharge(pick);
      const running = samples.filter((s) => s.phase === "running");
      expect(running.length, `${clip}: no dash frames`).toBeGreaterThan(0);
      const last = running[running.length - 1];
      expect(last.rate * SPIN_TURNS_PER_LOOP[last.clip]).toBeCloseTo(pinballPeakRevs(spec.speed), 6);
    }
  });

  it("holds an ambient roll between charges instead of a static hull", () => {
    // `walk` turns the seam ring only; the hull and the face do not rotate, so
    // the ambient window read as a sphere SLIDING. Zero here is the regression.
    const spec = BOSSES.pinball_boss.moves.pinballCharge!;
    const rt = freshPinballCharge(spec);
    const samples: RateSample[] = [];
    rt.t = rt.telegraphDur + 1;
    updatePinballCharge(rt, spec, recordingCtx(samples, rt));
    const idle = samples.filter((s) => s.phase === "idle");
    expect(idle.length, "an idle frame must set a rate").toBeGreaterThan(0);
    expect(idle[0].rate * SPIN_TURNS_PER_LOOP[PINBALL_AMBIENT_CLIP]).toBeCloseTo(PINBALL_SPIN.ambient, 6);
    expect(PINBALL_SPIN.ambient).toBeGreaterThan(0);
  });

  it("survives a ctx with no setAnimRate at all", () => {
    // Every call site is optional-chained; entities/pinball-boss.test.ts
    // supplies a ctx without it and must keep working.
    const spec = BOSSES.pinball_boss.moves.pinballCharge!;
    const rt = freshPinballCharge(spec);
    const ctx = recordingCtx([], rt, { setAnimRate: undefined });
    rt.t = rt.telegraphDur + 1;
    expect(() => updatePinballCharge(rt, spec, ctx)).not.toThrow();
  });
});

describe("the aliasing budget", () => {
  it("never advances more baked cells per frame than the bake can carry", () => {
    // At 60 Hz the display shows `32 * rate / 60` baked cells per frame.
    // Measured decorrelation on the shipped atlas hits the arbitrary-pair
    // baseline near a lag of 3.5 — past that consecutive frames are as
    // different as unrelated ones and the surface BOILS instead of reading as
    // faster, which is how pushing a spin harder makes it look slower.
    const KNEE = 3.4;
    for (const speed of [26, 30]) {
      for (const clip of CLIPS) {
        const cells = cellsPerDisplayedFrame(clip, pinballPeakRevs(speed), 60);
        expect(cells, `${clip} @ speed ${speed} would boil (${cells.toFixed(2)} cells/frame)`)
          .toBeLessThanOrEqual(KNEE);
      }
    }
  });

  it("still shows enough distinct cells per revolution to read as rotation", () => {
    for (const speed of [26, 30]) {
      for (const clip of CLIPS) {
        const revs = pinballPeakRevs(speed);
        const distinctPerRev = 60 / revs;
        expect(distinctPerRev, `${clip} @ ${speed}`).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it("the ceiling is a real constraint, not a number above every rate used", () => {
    // If `max` sat above anything reachable it would document nothing. Pin
    // that the clamp actually bites somewhere in the supported speed range.
    expect(pinballPeakRevs(40)).toBe(PINBALL_SPIN.max);
    expect(PINBALL_SPIN.peak).toBeLessThanOrEqual(PINBALL_SPIN.max);
    expect(PINBALL_SPIN.floor).toBeLessThan(PINBALL_SPIN.peak);
    expect(PINBALL_SPIN.ambient).toBeLessThan(PINBALL_SPIN.floor);
  });
});
