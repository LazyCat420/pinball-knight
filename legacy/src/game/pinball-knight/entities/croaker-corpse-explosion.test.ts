import { describe, it, expect, beforeEach } from "vitest";
import { state, freshPlayerFields } from "../state";
import { updateZombies } from "./zombie";
import { T_FLOOR } from "../maze/generator";
import type { Grid } from "../maze/generator";
import { FIXED_STEP } from "../constants";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const W = 21;

function openGrid(): Grid {
  const t = new Uint8Array(W * W).fill(T_FLOOR);
  return { w: W, h: W, t, shapes: new Uint8Array(W * W) } as Grid;
}

function fakeCroaker(x: number, z: number, mode: "chase" | "dead" = "dead"): Any {
  return {
    kind: "croaker",
    hp: mode === "dead" ? 0 : 10,
    maxHp: 10,
    mode,
    x,
    z,
    speed: 2,
    windupT: 0,
    cooldown: 99,
    dotT: 0, dotDmg: 0, dotTickT: 0, chillT: 0, flashT: 0, burnT: 0,
    aggro: true, stagger: 0, painT: 0, knockT: 0, kbx: 0, kbz: 0,
    hopT: 0, hopCd: 0, hopBounces: 0,
    sprite: { setTint() {}, mesh: { position: { set() {} } } },
    anim: { play() {}, setFacing() {}, setRate() {} },
    mesh: { position: { set() {} } },
  };
}

function fakeGoblin(x: number, z: number): Any {
  return {
    kind: "goblin",
    hp: 10,
    maxHp: 10,
    mode: "chase",
    x,
    z,
    speed: 2,
    windupT: 0,
    cooldown: 99,
    dotT: 0, dotDmg: 0, dotTickT: 0, chillT: 0, flashT: 0, burnT: 0,
    aggro: true, stagger: 0, painT: 0, knockT: 0, kbx: 0, kbz: 0,
    sprite: { setTint() {}, mesh: { position: { set() {} } } },
    anim: { play() {}, setFacing() {}, setRate() {} },
    mesh: { position: { set() {} } },
  };
}

describe("dead croaker corpse explosion when passed over", () => {
  beforeEach(() => {
    state.grid = openGrid();
    state.player = { x: 0, z: 0, ...freshPlayerFields() } as Any;
    state.player!.hp = 10;
    state.zombies = [];
    state.shakeT = 0;
  });

  it("does not explode when player is far away", () => {
    const deadCroaker = fakeCroaker(5, 5, "dead");
    state.zombies = [deadCroaker];
    state.player!.x = 0;
    state.player!.z = 0;

    updateZombies(FIXED_STEP);

    expect(state.zombies).toContain(deadCroaker);
    expect(state.shakeT).toBe(0);
  });

  it("explodes and removes dead croaker when player passes over its corpse", () => {
    const deadCroaker = fakeCroaker(1, 1, "dead");
    const nearbyGoblin = fakeGoblin(1.5, 1);
    state.zombies = [deadCroaker, nearbyGoblin];

    // Move player right onto the dead croaker's corpse
    state.player!.x = 1;
    state.player!.z = 1;

    updateZombies(FIXED_STEP);

    // The dead croaker corpse should be exploded & removed from state.zombies
    expect(state.zombies).not.toContain(deadCroaker);
    // Nearby goblin should take explosion damage from the blast
    expect(nearbyGoblin.hp).toBeLessThan(10);
    // Explosion should trigger screen shake
    expect(state.shakeT).toBeGreaterThan(0);
  });

  it("does not explode live croakers when stepped on", () => {
    const liveCroaker = fakeCroaker(1, 1, "chase");
    state.zombies = [liveCroaker];

    state.player!.x = 1;
    state.player!.z = 1;

    updateZombies(FIXED_STEP);

    expect(state.zombies).toContain(liveCroaker);
    expect(liveCroaker.mode).toBe("chase");
  });
});
