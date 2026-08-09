import { describe, it, expect } from "vitest";
import { buildRoom } from "./build";

describe("Native WebGPU Tavern Scene (Sub-Phase 7C)", () => {
  it("buildRoom creates native TransformNode, LightNode, and MeshNode structures", () => {
    const room = buildRoom();
    expect(room.group).toBeDefined();
    expect(room.fireLight.type).toBe("point");
    expect(room.flames.length).toBe(1);
    expect(room.group.children.length).toBeGreaterThan(0);
  });
});
