import { describe, it, expect } from "vitest";
import {
  MAW_SWALLOW_SPEED,
  MAW_SPIT_SPEED,
  MAW_CAPTURE_RADIUS,
  canMawSwallow,
  pickMawExit,
} from "./maw";
import type { PinballPart } from "../state";
import { type Grid, T_FLOOR, T_WALL, setTile, at } from "../maze/generator";

describe("maw (Monster Mouth) mechanics", () => {
  const mockMaw: PinballPart = {
    kind: "maw",
    i: 10,
    j: 10,
    x: 10.5,
    z: 10.5,
    dirX: 1, // mouth opens towards +x (faces +x)
    dirZ: 0,
    dir2X: 0,
    dir2Z: 0,
    cooldownT: 0,
    hitT: -1,
    mesh: {} as any,
  };

  it("requires speed >= MAW_SWALLOW_SPEED to swallow", () => {
    // Player approaching throat (moving in -x direction into mouth that faces +x)
    const fast = canMawSwallow(mockMaw, 10.5, 10.5, MAW_SWALLOW_SPEED + 2, -1, 0);
    const slow = canMawSwallow(mockMaw, 10.5, 10.5, MAW_SWALLOW_SPEED - 2, -1, 0);

    expect(fast).toBe(true);
    expect(slow).toBe(false); // bounces off teeth at low speed
  });

  it("requires entry within the forward throat cone (rejects rear/side glancing hits)", () => {
    // Approaching from rear (moving in +x direction)
    const fromRear = canMawSwallow(mockMaw, 10.5, 10.5, MAW_SWALLOW_SPEED + 5, 1, 0);
    expect(fromRear).toBe(false);

    // Approaching from perpendicular (moving in +z direction)
    const fromSide = canMawSwallow(mockMaw, 10.5, 10.5, MAW_SWALLOW_SPEED + 5, 0, 1);
    expect(fromSide).toBe(false);

    // Approaching at 30 degree angle into mouth (within 45 deg cone)
    const angle30 = Math.PI / 6;
    const from30Deg = canMawSwallow(
      mockMaw,
      10.5,
      10.5,
      MAW_SWALLOW_SPEED + 5,
      -Math.cos(angle30),
      Math.sin(angle30)
    );
    expect(from30Deg).toBe(true);
  });

  it("pickMawExit selects a valid floor tile within phi drop bounds", () => {
    const g: Grid = {
      w: 20,
      h: 20,
      t: new Uint8Array(20 * 20).fill(T_WALL),
      shapes: new Uint8Array(20 * 20),
    };
    const phi = new Int32Array(20 * 20).fill(100);

    // Create a 5x5 chamber of floor tiles
    for (let j = 5; j <= 15; j++) {
      for (let i = 5; i <= 15; i++) {
        setTile(g, i, j, T_FLOOR);
        phi[j * 20 + i] = 50 + (i - 5); // phi runs 50..60
      }
    }

    const exit = pickMawExit(g, phi, 10, 10, 55, () => 0.5);
    expect(exit).not.toBeNull();
    expect(at(g, exit!.i, exit!.j)).toBe(T_FLOOR);
    expect(phi[exit!.j * 20 + exit!.i]).toBeLessThanOrEqual(55);
  });
});
