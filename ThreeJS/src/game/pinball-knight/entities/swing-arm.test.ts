import { describe, it, expect } from "vitest";
import {
  SWING_RATE,
  SWING_ARC,
  SWING_LEN,
  SWING_THICK,
  SWING_RESTITUTION,
  MAX_SWEEP_OCCUPANCY,
  swingPhase,
  swingAngle,
  swingOmega,
  batImpulse,
  checkSwingArmContact,
} from "./swing-arm";
import { PLAYER_R } from "../constants";
import type { PinballPart } from "../state";

describe("swing-arm analytical mechanics", () => {
  it("phase and angle oscillate deterministically from simT", () => {
    const t0 = 0;
    const t1 = Math.PI / (2 * SWING_RATE);
    const p0 = swingPhase(t0, 0, 0);
    const p1 = swingPhase(t1, 0, 0);
    expect(p0).toBe(0);
    expect(p1).toBeCloseTo(Math.PI / 2);

    const a0 = swingAngle(t0, 0, 0);
    const a1 = swingAngle(t1, 0, 0);
    expect(a0).toBeCloseTo(0);
    expect(a1).toBeCloseTo(SWING_ARC / 2);

    const w0 = swingOmega(t0, 0, 0);
    const w1 = swingOmega(t1, 0, 0);
    expect(w0).toBeCloseTo((SWING_ARC / 2) * SWING_RATE);
    expect(w1).toBeCloseTo(0); // zero-crossing at peak angle
  });

  it("occupancy inequality holds: sweep does not block corridor like a toll booth", () => {
    const occupancy = (2 * (PLAYER_R + SWING_THICK)) / (SWING_ARC * SWING_LEN);
    expect(occupancy).toBeLessThanOrEqual(MAX_SWEEP_OCCUPANCY);
  });

  describe("batImpulse momentum transfer", () => {
    const e = SWING_RESTITUTION;

    it("stationary ball hit by moving arm tip: exit = (1+e)*omega*r", () => {
      const armV = 10;
      // arm moving in +x direction with normal (1, 0)
      const res = batImpulse(0, 0, armV, 0, 1, 0, e);
      expect(res).not.toBeNull();
      // vx exit = 0 - (1+e)*(0 - 10)*1 = (1+e)*10
      expect(res!.vx).toBeCloseTo((1 + e) * armV);
      expect(res!.vz).toBe(0);
    });

    it("head-on collision reflects player speed and adds arm speed", () => {
      const armV = 8;
      const pVx = -10; // heading directly into arm (+x normal)
      const res = batImpulse(pVx, 0, armV, 0, 1, 0, e);
      expect(res).not.toBeNull();
      // relN = (-10 - 8)*1 = -18
      // vx = -10 - (1 + 0.9)*(-18)*1 = -10 + 34.2 = 24.2
      expect(res!.vx).toBeCloseTo(-pVx * e + (1 + e) * armV);
    });

    it("outrunning the surface returns null (dodge)", () => {
      const armV = 5;
      const pVx = 12; // player moving away in +x faster than arm
      const res = batImpulse(pVx, 0, armV, 0, 1, 0, e);
      expect(res).toBeNull();
    });
  });

  describe("checkSwingArmContact", () => {
    const mockPart: PinballPart = {
      kind: "swingarm",
      i: 0,
      j: 0,
      x: 10,
      z: 10,
      dirX: 1, // base heading +x
      dirZ: 0,
      dir2X: 0,
      dir2Z: 0,
      cooldownT: 0,
      hitT: -1,
      mesh: {} as any,
    };

    it("detects contact and returns impulse when ball is swept by the blade", () => {
      // At simT = 0, angle is 0 (aimed along +x), omega is maximum in +z direction
      const contact = checkSwingArmContact(
        mockPart,
        10 + 1.0, // along arm length r=1.0
        10 + 0.1, // slightly on +z side
        10 + 1.0,
        10 + 0.1,
        0,
        0,
        0 // simT=0
      );

      expect(contact).not.toBeNull();
      expect(contact!.hit).toBe(true);
      expect(contact!.vz).toBeGreaterThan(0); // pushed in positive omega direction (+z)
    });

    it("returns null when player is far outside arm reach", () => {
      const contact = checkSwingArmContact(
        mockPart,
        10 + 3.0, // outside SWING_LEN
        10 + 3.0,
        10 + 3.0,
        10 + 3.0,
        0,
        0,
        0
      );
      expect(contact).toBeNull();
    });
  });
});
