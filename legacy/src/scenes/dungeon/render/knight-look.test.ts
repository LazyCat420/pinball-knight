import { describe, expect, it } from "vitest";
import { FULL_PLATE, lookFromGear, lookKey } from "./knight-look";

describe("knight look (gear → sprite ramps)", () => {
  it("reads a piece as worn while it has durability, gone at 0", () => {
    // Boots use the `1` equipped-sentinel; armor counts down its soak in
    // combat and the piece must visually vanish the frame it shatters.
    expect(lookFromGear({})).toEqual({ helmet: false, armor: false, boots: false });
    expect(lookFromGear({ helmet: 3, armor: 5, boots: 1 })).toEqual({ helmet: true, armor: true, boots: true });
    expect(lookFromGear({ helmet: 0, armor: 1 })).toEqual({ helmet: false, armor: true, boots: false });
  });

  it("produces stable, distinct cache keys per (weapon, look)", () => {
    expect(lookKey("sword", FULL_PLATE)).toBe("sword|111");
    expect(lookKey("sword", { helmet: false, armor: false, boots: false })).toBe("sword|000");
    expect(lookKey("mace", FULL_PLATE)).toBe("mace|111");
    // The key IS the identity — two different looks must never collide.
    expect(lookKey("sword", { helmet: true, armor: false, boots: false })).not.toBe(lookKey("sword", { helmet: false, armor: true, boots: false }));
  });

  it("FULL_PLATE is the frozen legacy default", () => {
    expect(FULL_PLATE).toEqual({ helmet: true, armor: true, boots: true });
    expect(Object.isFrozen(FULL_PLATE)).toBe(true);
  });
});
