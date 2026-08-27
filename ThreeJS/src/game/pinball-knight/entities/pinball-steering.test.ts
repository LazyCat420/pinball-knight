import { describe, it, expect } from "vitest";
import { resolvePinballSteering, type PinballSteeringInput } from "./pinball-steering";
import {
  PINBALL_STEER,
  PINBALL_TURN_BOOST_MAX,
  PINBALL_TURN_BOOST_START_DOT,
  PINBALL_COUNTER_BRAKE_DOT,
} from "../constants";

describe("resolvePinballSteering", () => {
  const baseInput: PinballSteeringInput = {
    momX: 1,
    momZ: 0,
    momSpeed: 10,
    aimX: 1,
    aimZ: 0,
    steerMul: 1,
    dt: 0.016,
  };

  it("forward aim retains baseline steering with 0 opposition and no braking", () => {
    const res = resolvePinballSteering({ ...baseInput, aimX: 1, aimZ: 0 });
    expect(res.dot).toBeCloseTo(1.0);
    expect(res.opposition).toBe(0);
    expect(res.momSpeed).toBe(10);
    expect(res.momX).toBeCloseTo(1.0);
    expect(res.momZ).toBe(0);
  });

  it("sideways aim (90°) provides moderate boosted bend without braking", () => {
    const res = resolvePinballSteering({ ...baseInput, aimX: 0, aimZ: 1 });
    expect(res.dot).toBeCloseTo(0.0);
    // dot 0.0 is below PINBALL_TURN_BOOST_START_DOT (0.15) but above PINBALL_COUNTER_BRAKE_DOT (-0.45)
    expect(res.opposition).toBeGreaterThan(0);
    expect(res.momSpeed).toBe(10); // No counter-brake applied
    expect(res.momZ).toBeGreaterThan(0); // Curving into +z
  });

  it("reverse aim (180°) applies maximum turn boost and directional forward braking", () => {
    const res = resolvePinballSteering({ ...baseInput, aimX: -1, aimZ: 0 });
    expect(res.dot).toBeCloseTo(-1.0);
    expect(res.opposition).toBeCloseTo(1.0);
    expect(res.momSpeed).toBeLessThan(10); // Counter-braked
  });

  it("counter-braking does not reduce speed below zero", () => {
    const res = resolvePinballSteering({
      ...baseInput,
      momSpeed: 0.01,
      aimX: -1,
      aimZ: 0,
      dt: 1.0,
    });
    expect(res.momSpeed).toBeGreaterThanOrEqual(0);
  });

  it("steerMul = 0 leaves momentum unchanged", () => {
    const res = resolvePinballSteering({
      ...baseInput,
      steerMul: 0,
      aimX: -1,
      aimZ: 0,
    });
    expect(res.momX).toBe(1);
    expect(res.momZ).toBe(0);
    expect(res.momSpeed).toBe(10);
    expect(res.opposition).toBe(0);
  });

  it("large dt spike is clamped by PINBALL_TURN_MAX_DELTA", () => {
    const res = resolvePinballSteering({
      ...baseInput,
      aimX: 0,
      aimZ: 1,
      dt: 10.0, // huge lag spike
    });
    expect(Number.isFinite(res.momX)).toBe(true);
    expect(Number.isFinite(res.momZ)).toBe(true);
    const len = Math.hypot(res.momX, res.momZ);
    expect(len).toBeCloseTo(1.0);
  });

  describe("discrete simulation scenarios", () => {
    it("sustained reverse aim produces a smooth U-turn in open space", () => {
      let momX = 1;
      let momZ = 0;
      let momSpeed = 12;
      const dt = 1 / 60;

      // Hold reverse aim (+z and -x) for 60 frames (1 second)
      for (let f = 0; f < 60; f++) {
        const res = resolvePinballSteering({
          momX,
          momZ,
          momSpeed,
          aimX: -1,
          aimZ: 0.2,
          steerMul: 1.0,
          dt,
        });
        momX = res.momX;
        momZ = res.momZ;
        momSpeed = res.momSpeed;
      }

      // Heading should have reversed along x
      expect(momX).toBeLessThan(0);
    });

    it("reverse aim turns noticeably tighter than baseline side steering", () => {
      // Baseline 90° steer over 20 frames
      let baseMomX = 1, baseMomZ = 0;
      for (let f = 0; f < 20; f++) {
        const res = resolvePinballSteering({
          momX: baseMomX,
          momZ: baseMomZ,
          momSpeed: 12,
          aimX: 0,
          aimZ: 1,
          steerMul: 1.0,
          dt: 1 / 60,
        });
        baseMomX = res.momX;
        baseMomZ = res.momZ;
      }

      // Reverse-angle steer (135°) over 20 frames
      let revMomX = 1, revMomZ = 0;
      for (let f = 0; f < 20; f++) {
        const res = resolvePinballSteering({
          momX: revMomX,
          momZ: revMomZ,
          momSpeed: 12,
          aimX: -0.707,
          aimZ: 0.707,
          steerMul: 1.0,
          dt: 1 / 60,
        });
        revMomX = res.momX;
        revMomZ = res.momZ;
      }

      // Reverse steer should have bent the x heading significantly further back than side steer
      expect(revMomX).toBeLessThan(baseMomX);
    });

    it("oil reduces turn authority consistently", () => {
      const normalRes = resolvePinballSteering({
        ...baseInput,
        aimX: -1,
        aimZ: 0,
        steerMul: 1.0,
      });

      const oilRes = resolvePinballSteering({
        ...baseInput,
        aimX: -1,
        aimZ: 0,
        steerMul: 0.15, // OIL_STEER_FACTOR
      });

      // Oil experiences less brake and less angular deflection
      expect(oilRes.momSpeed).toBeGreaterThan(normalRes.momSpeed);
    });
  });
});
