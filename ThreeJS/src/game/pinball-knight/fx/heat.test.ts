/**
 * Heat-source projection — and the v-flip that is invisible when wrong.
 *
 * The pass samples its render targets through `rtUv()`, which flips v. A spot
 * projected without the `1 -` therefore lands MIRRORED VERTICALLY, and heat haze
 * is subtle enough (plus a dungeon frame symmetric enough) that the shimmer just
 * appears somewhere else and still looks plausible. This repo has got that flip
 * wrong twice on other render-target hops.
 *
 * So the probe below is deliberately placed OFF-CENTRE in BOTH axes: a centred
 * probe passes under a mirror, which would make the test worse than nothing.
 */
import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../entities/marble", () => ({ activeMaterial: () => null }));

const { state } = await import("../state");
const { HEAT_SPOTS, droppedHeatSources, lastHeatSources, pushHeatField } = await import("./heat");

/** A capturing stand-in for the pass's `setHeat`. */
function fakePass() {
  const calls: Array<{ xs: number[]; ys: number[]; rs: number[]; n: number; t: number }> = [];
  return {
    calls,
    sizing: () => ({ renderW: 640 }),
    setHeat: (xs: Float32Array, ys: Float32Array, rs: Float32Array, n: number, t: number) => {
      calls.push({ xs: [...xs], ys: [...ys], rs: [...rs], n, t });
    },
  };
}

/** An orthographic camera looking straight down — so screen x/y map to world x/z
 *  with no isometric rotation to reason about. */
function topDownCam(): THREE.OrthographicCamera {
  const c = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
  c.position.set(0, 20, 0);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld(true);
  c.updateProjectionMatrix();
  return c;
}

beforeEach(() => {
  state.floorFx = [];
  state.pinballParts = [];
  state.player = null as unknown as typeof state.player;
  state.maze = null as unknown as typeof state.maze;
});

function fire(x: number, z: number, radius = 1, life = 5, maxLife = 5) {
  return { kind: "fire", x, z, radius, life, maxLife } as unknown as (typeof state.floorFx)[number];
}

describe("pushHeatField", () => {
  it("agrees with the pass about how many slots there are", () => {
    // Two copies of the same number in two modules is exactly how a shader ends
    // up reading a uniform array the CPU never fills.
    expect(HEAT_SPOTS).toBe(8);
  });

  it("reports no sources when nothing is hot", () => {
    const pass = fakePass();
    pushHeatField(topDownCam(), pass, 1.5, 72);
    expect(pass.calls[0]!.n).toBe(0);
    expect(pass.calls[0]!.t).toBe(1.5);
  });

  it("projects a fire to the correct QUADRANT, v-flip included", () => {
    // Under a top-down camera, world +x is screen right and world +z is screen
    // DOWN. So a fire at (+x, +z) must land at u > 0.5 and v > 0.5 in RT UV.
    //
    // Both coordinates are off-centre on purpose: if the `1 -` were missing this
    // would land at v < 0.5 and fail, whereas a probe on either axis' centre line
    // would pass either way.
    state.floorFx = [fire(5, 5)];
    const pass = fakePass();
    pushHeatField(topDownCam(), pass, 0, 72);
    const c = pass.calls[0]!;
    expect(c.n).toBe(1);
    expect(c.xs[0], "world +x should be screen right").toBeGreaterThan(0.5);
    expect(c.ys[0], "world +z should be screen DOWN — the rtUv v-flip is missing").toBeGreaterThan(0.5);
  });

  it("puts the opposite corner in the opposite quadrant", () => {
    state.floorFx = [fire(-5, -5)];
    const pass = fakePass();
    pushHeatField(topDownCam(), pass, 0, 72);
    const c = pass.calls[0]!;
    expect(c.xs[0]).toBeLessThan(0.5);
    expect(c.ys[0]).toBeLessThan(0.5);
  });

  it("gives a bigger fire a bigger radius", () => {
    state.floorFx = [fire(0, 0, 2)];
    const pass = fakePass();
    pushHeatField(topDownCam(), pass, 0, 72);
    const big = pass.calls[0]!.rs[0]!;
    state.floorFx = [fire(0, 0, 0.5)];
    const pass2 = fakePass();
    pushHeatField(topDownCam(), pass2, 0, 72);
    expect(big).toBeGreaterThan(pass2.calls[0]!.rs[0]!);
  });

  it("ranks a dying fire below a fresh one of the same size", () => {
    // So a pool guttering out stops bending the air before it stops being drawn.
    state.floorFx = [fire(1, 1, 1, 0.2, 10), fire(-1, -1, 1, 9, 10)];
    const pass = fakePass();
    pushHeatField(topDownCam(), pass, 0, 72);
    const ranked = lastHeatSources();
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
    // The fresh one is at (-1,-1), so it must be the one in the first slot.
    expect(pass.calls[0]!.xs[0]).toBeLessThan(0.5);
  });

  it("caps at HEAT_SPOTS and REPORTS what it dropped", () => {
    // A silent top-N cap reads as "covered everything". `droppedHeatSources()`
    // exists so the debug panel can say otherwise.
    state.floorFx = Array.from({ length: 14 }, (_, i) => fire((i % 4) - 2, Math.floor(i / 4) - 2, 1));
    const pass = fakePass();
    pushHeatField(topDownCam(), pass, 0, 72);
    expect(pass.calls[0]!.n).toBe(HEAT_SPOTS);
    expect(droppedHeatSources()).toBe(14 - HEAT_SPOTS);
  });

  it("zeroes the unused slots", () => {
    // Radius 0 is what the shader's guard reads as "unused". A stale radius would
    // keep a dead fire shimmering — the effect outliving its cause.
    state.floorFx = [fire(0, 0)];
    const pass = fakePass();
    pushHeatField(topDownCam(), pass, 0, 72);
    const c = pass.calls[0]!;
    for (let i = c.n; i < HEAT_SPOTS; i++) expect(c.rs[i]).toBe(0);
  });

  it("skips an off-screen source rather than spending a slot on it", () => {
    state.floorFx = [fire(500, 500), fire(1, 1)];
    const pass = fakePass();
    pushHeatField(topDownCam(), pass, 0, 72);
    // Only the on-screen one is pushed, and it gets slot 0.
    expect(pass.calls[0]!.n).toBe(1);
    expect(pass.calls[0]!.xs[0]).toBeGreaterThan(0.5);
  });

  it("ignores a fire vent that is only sputtering", () => {
    // The sputter is a WARNING, not heat. Shimmering on the tell would spoil the
    // read that the tell exists to give.
    state.pinballParts = [
      { kind: "firevent", x: 1, z: 1, dirX: 1, dirZ: 0, hitT: 0.01 },
    ] as unknown as typeof state.pinballParts;
    const pass = fakePass();
    pushHeatField(topDownCam(), pass, 0, 72);
    expect(pass.calls[0]!.n).toBe(0);
  });
});
