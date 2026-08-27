import { describe, it, expect } from "vitest";
import { resolvePinballSteering, type PinballSteeringInput } from "./pinball-steering";
import {
  PINBALL_STEER,
  PINBALL_TURN_BOOST_MAX,
  PINBALL_TURN_BOOST_START_DOT,
  PINBALL_COUNTER_BRAKE_DOT,
} from "../constants";

describe("resolvePinballSteering (angular slew & U-turn mechanics)", () => {
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
    expect(res.momZ).toBeCloseTo(0.0);
  });

  it("sideways aim (90°) curves smoothly without counter-braking", () => {
    const res = resolvePinballSteering({ ...baseInput, aimX: 0, aimZ: 1 });
    expect(res.dot).toBeCloseTo(0.0);
    // dot 0.0 is above PINBALL_COUNTER_BRAKE_DOT (-0.20)
    expect(res.momSpeed).toBe(10); // No counter-braking
    expect(res.momZ).toBeGreaterThan(0); // Heading rotated into +z
  });

  it("exact 180° dead-rearward aim immediately rotates heading angle", () => {
    const res = resolvePinballSteering({ ...baseInput, aimX: -1, aimZ: 0, dt: 1 / 60 });
    expect(res.dot).toBeCloseTo(-1.0);
    expect(res.opposition).toBeCloseTo(1.0);
    // Heading must have rotated away from (1, 0)
    expect(res.momX).toBeLessThan(1.0);
    expect(Math.abs(res.momZ)).toBeGreaterThan(0.05);
    expect(res.momSpeed).toBeLessThan(10); // Directional counter-braked
  });

  it("sustained reverse aim executes a tight U-turn in under 0.4 seconds", () => {
    let momX = 1;
    let momZ = 0;
    let momSpeed = 16;
    const dt = 1 / 60;
    let maxForwardDisplacement = 0;
    let currentX = 0;
    let framesToTurn = 0;

    // Hold reverse aim for 30 frames (0.5s)
    for (let f = 0; f < 30; f++) {
      const step = momSpeed * dt;
      currentX += momX * step;
      maxForwardDisplacement = Math.max(maxForwardDisplacement, currentX);

      const res = resolvePinballSteering({
        momX,
        momZ,
        momSpeed,
        aimX: -1,
        aimZ: 0,
        steerMul: 1.0,
        dt,
      });
      momX = res.momX;
      momZ = res.momZ;
      momSpeed = res.momSpeed;

      if (momX < 0 && framesToTurn === 0) {
        framesToTurn = f + 1;
      }
    }

    // Must have reversed heading in under 25 frames (~0.4s)
    expect(framesToTurn).toBeGreaterThan(0);
    expect(framesToTurn).toBeLessThanOrEqual(25);
    // Total forward travel overshoot must be compact (< 2.5 tiles)
    expect(maxForwardDisplacement).toBeLessThan(2.5);
    // Final heading must be pointing backwards (-x)
    expect(momX).toBeLessThan(-0.8);
  });

  it("low-speed rolling (< 4 u/s) grants agile steering boost", () => {
    const highSpeedRes = resolvePinballSteering({
      ...baseInput,
      momSpeed: 12,
      aimX: 0,
      aimZ: 1,
      dt: 1 / 60,
    });

    const lowSpeedRes = resolvePinballSteering({
      ...baseInput,
      momSpeed: 2,
      aimX: 0,
      aimZ: 1,
      dt: 1 / 60,
    });

    // Low-speed heading rotation must be strictly greater than high-speed
    expect(lowSpeedRes.momZ).toBeGreaterThan(highSpeedRes.momZ);
  });

  it("steerMul = 0 leaves momentum completely unchanged", () => {
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

  it("oil reduces angular authority and braking proportionally", () => {
    const normalRes = resolvePinballSteering({
      ...baseInput,
      aimX: -1,
      aimZ: 0,
      steerMul: 1.0,
      dt: 1 / 60,
    });

    const oilRes = resolvePinballSteering({
      ...baseInput,
      aimX: -1,
      aimZ: 0,
      steerMul: 0.15,
      dt: 1 / 60,
    });

    // Oil retains higher speed and rotates less
    expect(oilRes.momSpeed).toBeGreaterThan(normalRes.momSpeed);
    expect(oilRes.momX).toBeGreaterThan(normalRes.momX);
  });
});
