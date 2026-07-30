/**
 * THE BEDS ARE POLLED, EVERY FRAME, FROM THE FLOOR-FX UPDATE.
 *
 * `sfx/ambience.ts` deliberately has no stop() — a voice dies because nothing
 * refreshed it. That makes the CALL SITE the whole contract, and a call site
 * that runs only when something changes, or that skips a frame when the list is
 * empty, turns "no fire nearby" into "a fire that plays forever". So this
 * asserts the poll is unconditional, and that the level it hands over is a
 * function of where the player is standing.
 *
 * Audio is mocked to a recorder rather than run: this is about WHO CALLS WHAT
 * and with what number — `sfx/ambience.test.ts` owns the node graph.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const calls: Array<{ id: string; level: number }> = [];
vi.mock("../sfx/ambience", () => ({
  ambience: (id: string, level: number) => calls.push({ id, level }),
  resetAmbience: () => {},
  ambienceVoices: () => 0,
}));

const { spawnFloorFx, updateFloorFx, clearFloorFx } = await import("./floor-fx");
const { state } = await import("../state");
const { OIL_SLICK_RADIUS, OIL_SLICK_LIFE, FROST_RUNE_RADIUS, FROST_RUNE_LIFE } = await import("../constants");

/** The level handed to one bed on the most recent poll. */
function level(id: string): number {
  const last = [...calls].reverse().find((c) => c.id === id);
  return last?.level ?? -1;
}

beforeEach(() => {
  clearFloorFx();
  calls.length = 0;
  state.scene = { add() {}, remove() {} } as unknown as typeof state.scene;
  state.vfx = undefined as never;
  state.grid = null;
  state.zombies = [];
  state.dbgMaterialFloorFx = true;
  state.dbgMaterialSelfHarm = false;
  state.player = { x: 0, z: 0, momSpeed: 0, oilT: 0, hp: 3, iframes: 0 } as unknown as typeof state.player;
});

describe("the ambience poll", () => {
  it("runs on EVERY update, even with an empty floor", () => {
    // The unconditional part is the contract. A poll that skipped the empty case
    // would be a bed that never learns the room went quiet — except that here
    // the silence is the poll's own job to report.
    for (let i = 0; i < 3; i++) updateFloorFx(0.016);
    expect(calls.filter((c) => c.id === "fire")).toHaveLength(3);
    expect(calls.filter((c) => c.id === "water")).toHaveLength(3);
    expect(level("fire")).toBe(0);
    expect(level("water")).toBe(0);
  });

  it("lights the fire bed when the knight is standing in a burning pool", () => {
    spawnFloorFx("fire", 0, 0, 1.2, 4);
    updateFloorFx(0.016);
    expect(level("fire")).toBeGreaterThan(0.8);
    expect(level("water")).toBe(0);
  });

  it("falls off with distance, and is silent past the audible range", () => {
    spawnFloorFx("fire", 0, 0, 1, 4);
    const p = state.player!;
    p.x = 3;
    updateFloorFx(0.016);
    const near = level("fire");
    p.x = 6;
    updateFloorFx(0.016);
    const far = level("fire");
    p.x = 40;
    updateFloorFx(0.016);
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
    expect(level("fire"), "a pool across the level must not be audible").toBe(0);
  });

  it("sums the pools of one kind instead of opening a second bed", () => {
    spawnFloorFx("fire", 0, 0, 1, 4);
    updateFloorFx(0.016);
    const one = level("fire");
    spawnFloorFx("fire", 0.5, 0.5, 1, 4);
    updateFloorFx(0.016);
    expect(level("fire")).toBeGreaterThan(one);
    // Still ONE call per kind per frame — the accumulation is the caller's job.
    expect(calls.filter((c) => c.id === "fire")).toHaveLength(2);
  });

  it("routes a slick to WATER, and leaves the silent kinds silent", () => {
    spawnFloorFx("oil", 0, 0, OIL_SLICK_RADIUS, OIL_SLICK_LIFE);
    updateFloorFx(0.016);
    expect(level("water")).toBeGreaterThan(0);
    expect(level("fire")).toBe(0);

    clearFloorFx();
    calls.length = 0;
    // Frost has no bed by design — see the AmbienceId docblock.
    spawnFloorFx("frost", 0, 0, FROST_RUNE_RADIUS, FROST_RUNE_LIFE);
    updateFloorFx(0.016);
    expect(level("fire")).toBe(0);
    expect(level("water")).toBe(0);
  });

  it("goes quiet the frame the pool despawns", () => {
    // The one transition a poll gets for free and a start/stop design has to
    // remember: the fx list is walked after the despawn sweep, so a burnt-out
    // pool contributes nothing without anything having to notice it ended.
    spawnFloorFx("fire", 0, 0, 1, 0.02);
    updateFloorFx(0.016);
    expect(level("fire")).toBeGreaterThan(0);
    updateFloorFx(0.016);
    expect(level("fire")).toBe(0);
  });
});
