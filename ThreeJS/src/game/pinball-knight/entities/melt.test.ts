/**
 * THE MELT — the scar a lava ball leaves in the floor it rolls over.
 *
 * Sibling of groove.test.ts, and deliberately shaped like it: the two trails
 * share the stamp-by-DISTANCE rig, so they share the properties worth pinning
 * (even spacing at any framerate, a speed floor) — plus the two that make this
 * one a different thing from both the groove and the fire puddle it sits
 * between: it is COSMETIC, and it COOLS without vanishing.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { state } from "../state";
import { meltFloor, clearFloorFx, updateFloorFx, spawnFloorFx } from "./floor-fx";
import { MELT_MIN_SPEED, MELT_SPACING, MELT_LIFE, MELT_RADIUS, PINBALL_MAX_SPEED, FLOOR_FX_MAX } from "../constants";
import { MELT_COOL_SECONDS } from "../fx/elements/molten";

beforeEach(() => {
  state.scene = { add: () => {}, remove: () => {} } as unknown as typeof state.scene;
  state.dbgMaterialFloorFx = true;
  state.vfx = undefined as never;
  state.zombies = [];
  state.grid = null;
  state.player = null;
  clearFloorFx();
});

const melts = () => state.floorFx.filter((f) => f.kind === "molten");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeZombie(x: number, z: number): any {
  return { kind: "zombie", hp: 10, mode: "chase", x, z, burnT: 0, oiledT: 0, chillT: 0, slipT: 0 };
}

describe("melting", () => {
  it("melts nothing below the minimum speed — a slow lava ball just glows", () => {
    meltFloor(0, 0, MELT_MIN_SPEED - 0.1);
    expect(melts()).toHaveLength(0);
  });

  it("melts at and above the minimum speed, for MELT_LIFE", () => {
    meltFloor(0, 0, MELT_MIN_SPEED + 1);
    expect(melts()).toHaveLength(1);
    expect(melts()[0].life).toBeCloseTo(MELT_LIFE);
  });

  it("spaces stamps by distance, not by frame", () => {
    // Sixty calls without moving — a per-frame stamp would carpet the tile, and
    // at 144fps the wake would be twice as dense as at 60.
    for (let i = 0; i < 60; i++) meltFloor(4, 4, PINBALL_MAX_SPEED);
    expect(melts()).toHaveLength(1);
    // …and one that HAS moved a full spacing lays exactly one more.
    meltFloor(4 + MELT_SPACING * 1.01, 4, PINBALL_MAX_SPEED);
    expect(melts()).toHaveLength(2);
  });

  it("bites wider the faster you were going", () => {
    meltFloor(0, 0, MELT_MIN_SPEED);
    meltFloor(20, 0, PINBALL_MAX_SPEED);
    const [slow, fast] = melts();
    expect(fast.radius).toBeGreaterThan(slow.radius);
    // …but never so wide it stops being a trail and becomes a pool.
    expect(fast.radius).toBeLessThan(MELT_RADIUS * 1.5);
  });

  it("remembers the heading it was laid at", () => {
    meltFloor(0, 0, PINBALL_MAX_SPEED, 0, 3);
    expect(melts()[0].dirX).toBeCloseTo(0);
    expect(melts()[0].dirZ).toBeCloseTo(1); // normalised, not the raw 3
  });
});

describe("the melt is COSMETIC", () => {
  /**
   * The load-bearing test of this feature. Lava already scars the machine with
   * fire puddles on every fast bounce — that is the hazard, and it is balanced.
   * A second surface laid under the ball at ALL times, that also burned, would
   * quietly double the material's floor control while looking like an art
   * change. If someone later gives the scar teeth, they should have to delete
   * this test and mean it.
   */
  it("does not burn, chill, grease or trip anything standing in it", () => {
    meltFloor(0, 0, PINBALL_MAX_SPEED);
    const victim = fakeZombie(0.1, 0);
    state.zombies = [victim];
    const hp = victim.hp;
    for (let i = 0; i < 120; i++) updateFloorFx(0.016); // ~2s, several tick windows
    expect(victim.hp).toBe(hp);
    expect(victim.burnT).toBe(0);
    expect(victim.chillT).toBe(0);
    expect(victim.oiledT).toBe(0);
    expect(victim.slipT).toBe(0);
  });

  it("is the fire puddle that hurts, so the pair is not measuring nothing", () => {
    // The positive control for the test above: the same loop, the same victim,
    // a kind that DOES bite. Without it, "nothing happened to the zombie" would
    // pass just as well if updateFloorFx had stopped touching enemies at all.
    //
    // Asserted on `burnT` rather than on hp, because this harness runs with no
    // grid and `damageZombie` early-returns without one — hp would sit still
    // for a reason that has nothing to do with fire, which is precisely the
    // kind of silently-vacuous control this test exists to not be. burnT is set
    // in the same branch, one line earlier.
    spawnFloorFx("fire", 0, 0, 0.8, 3);
    const victim = fakeZombie(0.1, 0);
    state.zombies = [victim];
    for (let i = 0; i < 120; i++) updateFloorFx(0.016);
    expect(victim.burnT).toBeGreaterThan(0);
  });
});

describe("cooling", () => {
  it("cools well before it despawns, so a trail is a gradient in TIME", () => {
    // The scar's heat is driven by uAge against MELT_COOL_SECONDS, while the
    // decal lives MELT_LIFE. If cooling ever took as long as the life, the
    // whole trail would glow uniformly and blink out — the thing this split
    // exists to prevent.
    expect(MELT_COOL_SECONDS).toBeLessThan(MELT_LIFE * 1.25);
    expect(MELT_COOL_SECONDS).toBeGreaterThan(0.5);
  });

  it("holds its SIZE while it cools — melted floor does not grow back", () => {
    meltFloor(0, 0, PINBALL_MAX_SPEED);
    const scar = melts()[0];
    const r0 = scar.mesh.scale.x;
    for (let i = 0; i < 60; i++) updateFloorFx(0.016);
    expect(scar.mesh.scale.x).toBeCloseTo(r0, 5);
    expect(scar.mesh.scale.x).toBeCloseTo(scar.radius, 5);
  });
});

describe("the trail fits the floor-fx budget", () => {
  it("a full-speed run cannot evict everything else on the floor", () => {
    // The arithmetic in the MELT_LIFE docblock, executed: stamps land every
    // MELT_SPACING at PINBALL_MAX_SPEED, and live MELT_LIFE seconds.
    const stampsPerSecond = PINBALL_MAX_SPEED / MELT_SPACING;
    expect(stampsPerSecond * MELT_LIFE).toBeLessThan(FLOOR_FX_MAX * 0.75);
  });

  it("stays inside FLOOR_FX_MAX while lava's own puddles run alongside it", () => {
    let x = 0;
    for (let i = 0; i < 600; i++) {
      x += PINBALL_MAX_SPEED * 0.016;
      meltFloor(x, 0, PINBALL_MAX_SPEED);
      if (i % 25 === 0) spawnFloorFx("fire", x, 0, 0.8, 3); // a bounce puddle
      expect(state.floorFx.length).toBeLessThanOrEqual(FLOOR_FX_MAX);
      updateFloorFx(0.016);
      expect(state.floorFx.length).toBeLessThanOrEqual(FLOOR_FX_MAX);
    }
    // And the trail did not starve the puddles out of the budget entirely.
    expect(state.floorFx.some((f) => f.kind === "fire")).toBe(true);
  }, 20000);
});
