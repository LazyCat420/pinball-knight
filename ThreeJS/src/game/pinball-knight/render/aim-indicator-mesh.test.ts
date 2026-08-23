import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createAimIndicator } from "./aim-indicator";

describe("aim indicator mesh (real three.js)", () => {
  it("builds, hides by default, and orients to the heading", () => {
    const ind = createAimIndicator();
    expect(ind.group.visible).toBe(false);
    // Heading +X  -> rotation.y 0 ; heading +Z -> rotation.y -PI/2
    ind.update(5, 7, 1, 0, null, 11, 22);
    expect(ind.group.visible).toBe(true);
    expect(ind.group.position.x).toBe(5);
    expect(ind.group.position.z).toBe(7);
    const arrows = ind.group.children.filter((c: THREE.Object3D) => (c as THREE.Mesh).isMesh) as THREE.Mesh[];
    expect(arrows.length).toBe(3);
    const heading = arrows[arrows.length - 1];
    expect(heading.rotation.y).toBeCloseTo(0);
    ind.update(5, 7, 0, 1, null, 11, 22);
    expect(heading.rotation.y).toBeCloseTo(-Math.PI / 2);

    // Speed ramps the arrow length.
    ind.update(0, 0, 1, 0, null, 0, 22);
    const slow = heading.scale.x;
    ind.update(0, 0, 1, 0, null, 22, 22);
    expect(heading.scale.x).toBeGreaterThan(slow);

    // Steering shows the second arrow + bend wedge; no steer hides them.
    ind.update(0, 0, 1, 0, { x: 0, z: 1 }, 11, 22);
    expect(arrows[1].visible).toBe(true);
    expect(arrows[0].visible).toBe(true);
    ind.update(0, 0, 1, 0, null, 11, 22);
    expect(arrows[1].visible).toBe(false);
    expect(arrows[0].visible).toBe(false);

    // No NaN anywhere in the bend geometry after a turn.
    ind.update(0, 0, 1, 0, { x: -1, z: 0.01 }, 11, 22);
    const pos = (arrows[0].geometry.getAttribute("position").array as Float32Array);
    expect([...pos].some(Number.isNaN)).toBe(false);

    ind.hide();
    expect(ind.group.visible).toBe(false);
    ind.dispose();
  });
});
