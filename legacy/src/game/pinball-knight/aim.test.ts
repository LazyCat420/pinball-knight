import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import type { WebGPURenderer } from "three/webgpu";
import { mouseAimDirection, worldDirToScreen, screenDirToWorld } from "./camera";
import { createDungeonCamera } from "./camera";
import { state } from "./state";
import { VIEW_W, VIEW_H } from "./constants";

/**
 * Ranged aiming geometry. The bow fires toward the mouse cursor: we project the
 * player to the canvas, take the screen vector player→cursor, and convert it to
 * a world ground direction. These tests pin that mapping so a regression in the
 * projection (or an axis flip) is caught without a live browser.
 */

// A fake renderer whose canvas rect is a plain 0,0-anchored WxH box, so client
// pixels == canvas pixels and the NDC math is easy to reason about.
function fakeRenderer(w: number, h: number): WebGPURenderer {
  const dom = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h, right: w, bottom: h, x: 0, y: 0 }),
  };
  return { domElement: dom } as unknown as WebGPURenderer;
}

const W = 1280;
const H = 720;

beforeEach(() => {
  const cam = createDungeonCamera();
  // Point the camera at the origin the same way the game does (offset + lookAt).
  // Use the real aim path by placing the player at origin and aiming the camera.
  cam.position.set(10, 10, 10);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  state.camera = cam;
  state.renderer = fakeRenderer(W, H);
});

describe("mouseAimDirection", () => {
  it("returns a unit vector", () => {
    const d = mouseAimDirection(0, 0, { x: W * 0.75, y: H * 0.5 });
    expect(d).not.toBeNull();
    const len = Math.hypot(d!.x, d!.z);
    expect(len).toBeCloseTo(1, 5);
  });

  it("is null when the cursor sits on the player's screen point", () => {
    // Project the player to find its exact screen pixel, then aim there.
    const p = new THREE.Vector3(0, 0.5, 0).project(state.camera!);
    const px = ((p.x + 1) / 2) * W;
    const py = ((1 - p.y) / 2) * H;
    expect(mouseAimDirection(0, 0, { x: px, y: py })).toBeNull();
  });

  it("cursor to screen-right of the player aims along +screen-right in world", () => {
    // A cursor far to the right (and level) with the player at origin should aim
    // along the world direction that screenDirToWorld maps screen-right to.
    const p = new THREE.Vector3(0, 0.5, 0).project(state.camera!);
    const py = ((1 - p.y) / 2) * H;
    const d = mouseAimDirection(0, 0, { x: W - 1, y: py })!;
    const expected = screenDirToWorld(1, 0); // pure screen-right
    const el = Math.hypot(expected.x, expected.z);
    const dot = d.x * (expected.x / el) + d.z * (expected.z / el);
    expect(dot).toBeGreaterThan(0.98);
  });

  it("cursor above the player aims along screen-up in world", () => {
    const p = new THREE.Vector3(0, 0.5, 0).project(state.camera!);
    const px = ((p.x + 1) / 2) * W;
    const d = mouseAimDirection(0, 0, { x: px, y: 1 })!; // near the top edge
    const expected = screenDirToWorld(0, -1); // screen-up (dy negative)
    const el = Math.hypot(expected.x, expected.z);
    const dot = d.x * (expected.x / el) + d.z * (expected.z / el);
    expect(dot).toBeGreaterThan(0.98);
  });

  it("returns null without a camera or renderer", () => {
    state.camera = null;
    expect(mouseAimDirection(0, 0, { x: 100, y: 100 })).toBeNull();
  });
});

describe("worldDirToScreen ↔ screenDirToWorld round-trip", () => {
  it("screen-right and screen-up survive the round trip", () => {
    for (const [sx, sz] of [
      [1, 0],
      [0, 1],
      [0.6, -0.8],
    ]) {
      const w = screenDirToWorld(sx, sz);
      const back = worldDirToScreen(w.x, w.z);
      expect(back.x).toBeCloseTo(sx, 5);
      // screenDirToWorld treats +sz as screen-down; worldDirToScreen returns
      // screen-down as +z too, so the sign is preserved.
      expect(back.z).toBeCloseTo(sz, 5);
    }
  });
});
