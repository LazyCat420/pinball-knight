import { describe, expect, it } from "vitest";
import { Group, Mesh, MeshBasicMaterial, MeshStandardMaterial } from "three";
import { pixelProtection } from "./selective-pixel";

describe("selective scenery mask", () => {
  it("protects actors sharing a scenery material, and supports child opt-outs", () => {
    const material = new MeshStandardMaterial();
    const environment = new Group();
    environment.userData.pixelEnvironment = true;
    const wall = new Mesh(undefined, material);
    const actor = new Mesh(undefined, material);
    environment.add(wall);
    expect(pixelProtection(wall, material)).toBe(0);
    expect(pixelProtection(actor, material)).toBe(1);
    environment.add(actor);
    actor.userData.pixelEnvironment = false;
    expect(pixelProtection(actor, material)).toBe(1);
  });

  it("preserves cutouts, translucent effects and unlit art inside scenery", () => {
    const object = new Mesh();
    object.userData.pixelEnvironment = true;
    for (const material of [new MeshBasicMaterial(), new MeshStandardMaterial({ transparent: true }), new MeshStandardMaterial({ alphaTest: 0.5 })]) {
      expect(pixelProtection(object, material)).toBe(1);
    }
  });
});
