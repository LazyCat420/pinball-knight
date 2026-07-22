import { describe, expect, it } from "vitest";
import { FULL_PLATE, lookFromGear, lookKey } from "./knight-look";

describe("knight look (gear → sprite ramps)", () => {
  it("reads a piece as worn while it has durability, gone at 0", () => {
    // Boots use the `1` equipped-sentinel; armor counts down its soak in
    // combat and the piece must visually vanish the frame it shatters.
    expect(lookFromGear({}, "iron")).toEqual({ helmet: false, armor: false, boots: false, style: "iron" });
    expect(lookFromGear({ helmet: 3, armor: 5, boots: 1 }, "iron")).toEqual({ helmet: true, armor: true, boots: true, style: "iron" });
    expect(lookFromGear({ helmet: 0, armor: 1 }, "iron")).toEqual({ helmet: false, armor: true, boots: false, style: "iron" });
  });

  it("defaults to the worn armor style (iron with no unlocks/storage)", () => {
    // Headless node has no localStorage — armor-styles fails soft to iron.
    expect(lookFromGear({}).style).toBe("iron");
  });

  it("produces stable, distinct cache keys per (weapon, look, style)", () => {
    expect(lookKey("sword", FULL_PLATE)).toBe("sword|111|iron");
    expect(lookKey("sword", { helmet: false, armor: false, boots: false })).toBe("sword|000|iron");
    expect(lookKey("mace", FULL_PLATE)).toBe("mace|111|iron");
    // The key IS the identity — two different looks must never collide.
    expect(lookKey("sword", { helmet: true, armor: false, boots: false })).not.toBe(lookKey("sword", { helmet: false, armor: true, boots: false }));
    // …and the same plate in two styles is two different sheets.
    expect(lookKey("sword", { helmet: true, armor: true, boots: true, style: "ice" })).toBe("sword|111|ice");
    expect(lookKey("sword", { helmet: true, armor: true, boots: true, style: "ice" })).not.toBe(lookKey("sword", FULL_PLATE));
  });

  it("FULL_PLATE is the frozen legacy default (absent style = iron)", () => {
    expect(FULL_PLATE).toEqual({ helmet: true, armor: true, boots: true });
    expect(Object.isFrozen(FULL_PLATE)).toBe(true);
    expect(lookKey("sword", FULL_PLATE).endsWith("|iron")).toBe(true);
  });
});
