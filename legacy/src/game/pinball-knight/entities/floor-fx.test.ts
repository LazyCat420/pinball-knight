/**
 * Oil-pool behavior (Slick Field): the floor-fx overlap loop greases enemies,
 * feeds the rolling ball's oilT glide, and any overlapping FIRE ignites the
 * whole pool. Rendering is exercised only through THREE's headless scene-graph
 * objects (real meshes, stubbed scene); VFX/audio stay undefined per house rule.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { spawnFloorFx, updateFloorFx, clearFloorFx } from "./floor-fx";
import { state } from "../state";
import { OIL_ZOMBIE_T, OIL_MARBLE_T, OIL_IGNITE_LIFE, OIL_SLICK_RADIUS, OIL_SLICK_LIFE } from "../constants";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeZombie(x: number, z: number): any {
  return { kind: "zombie", hp: 10, mode: "chase", x, z, burnT: 99, oiledT: 0 };
}

beforeEach(() => {
  clearFloorFx();
  state.scene = { add() {}, remove() {} } as unknown as typeof state.scene;
  state.vfx = undefined as never;
  state.grid = null;
  state.zombies = [];
  state.dbgMaterialFloorFx = true;
  state.dbgMaterialSelfHarm = false;
  state.player = { x: 50, z: 50, momSpeed: 0, oilT: 0, hp: 3, iframes: 0 } as unknown as typeof state.player;
});

describe("oil pool overlap", () => {
  it("greases enemies standing in it and tops up the rolling ball's oilT", () => {
    spawnFloorFx("oil", 0, 0, OIL_SLICK_RADIUS, OIL_SLICK_LIFE);
    const inPool = fakeZombie(0.5, 0);
    const outside = fakeZombie(9, 9);
    state.zombies = [inPool, outside];
    const p = state.player!;
    p.x = 0;
    p.z = 0.5;
    p.momSpeed = 8; // rolling
    updateFloorFx(0.016);
    expect(inPool.oiledT).toBe(OIL_ZOMBIE_T);
    expect(outside.oiledT).toBe(0);
    expect(p.oilT).toBe(OIL_MARBLE_T);
  });

  it("does not grease the ball while walking (momSpeed 0)", () => {
    spawnFloorFx("oil", 0, 0, OIL_SLICK_RADIUS, OIL_SLICK_LIFE);
    const p = state.player!;
    p.x = 0;
    p.z = 0;
    p.momSpeed = 0;
    updateFloorFx(0.016);
    expect(p.oilT).toBe(0);
  });
});

describe("oil ignition", () => {
  it("converts the whole pool to a long fire when any fire fx overlaps it", () => {
    spawnFloorFx("oil", 0, 0, OIL_SLICK_RADIUS, OIL_SLICK_LIFE);
    spawnFloorFx("fire", 1.2, 0, 0.55, 3.5); // a flipper-trail scar clipping the pool
    updateFloorFx(0.016);
    const oils = state.floorFx.filter((f) => f.kind === "oil");
    const fires = state.floorFx.filter((f) => f.kind === "fire");
    expect(oils).toHaveLength(0);
    // The original scar plus the ignited pool, burning at the pool's footprint.
    expect(fires).toHaveLength(2);
    const ignited = fires.find((f) => f.radius === OIL_SLICK_RADIUS);
    expect(ignited).toBeDefined();
    expect(ignited!.maxLife).toBe(OIL_IGNITE_LIFE);
  });

  it("leaves a fire-free pool alone", () => {
    spawnFloorFx("oil", 0, 0, OIL_SLICK_RADIUS, OIL_SLICK_LIFE);
    spawnFloorFx("fire", 9, 9, 0.55, 3.5); // far away
    updateFloorFx(0.016);
    expect(state.floorFx.filter((f) => f.kind === "oil")).toHaveLength(1);
  });
});
