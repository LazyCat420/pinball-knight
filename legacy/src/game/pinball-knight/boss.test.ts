/**
 * Reaper King boss contract — the part that gates progression.
 *
 * Runs in the default node env (no DOM): `showToast` self-guards on
 * `state.container`, which we leave null, and every boss mesh is plain THREE
 * geometry (no canvas), so the whole contract is exercisable headlessly.
 *
 * Can't drive the real GPU sim here, but the boss is injectable (`makeZombie` is
 * passed in) and reads plain `state`, so the load-bearing behaviour is testable
 * headlessly: spawning SEALS the exit, and the king's death OPENS it (the portal
 * blooms). If either breaks, a boss floor becomes either impassable or trivially
 * skippable — both run-ending bugs.
 */
import { test, beforeEach, expect } from "vitest";
import * as THREE from "three";
import { spawnBoss, updateBoss, disposeBoss, bossActive } from "./boss";
import { state } from "./state";
import type { Grid } from "./maze/generator";
import type { Zombie } from "./state";

function makeGrid(): Grid {
  return { w: 7, h: 7, t: new Uint8Array(49), shapes: new Uint8Array(49) };
}

/** A stand-in Zombie the injected spawner returns — no sprite pipeline needed. */
function fakeZombie(x: number, z: number, hp: number): Zombie {
  return {
    x,
    z,
    hp,
    maxHp: hp,
    boss: true,
    kind: "brute",
    mode: "idle",
    speed: 2,
    windupT: 0,
    cooldown: 0,
    flashT: 0,
    aggro: false,
    burnT: 0,
    bobT: 0,
    anim: { setFacing() {}, play() {}, setRate() {}, update() {} },
    sprite: {
      setTint() {},
      mesh: { scale: { multiplyScalar() {} }, position: new THREE.Vector3() },
    },
  } as unknown as Zombie;
}

beforeEach(() => {
  disposeBoss();
  state.scene = new THREE.Scene();
  state.grid = makeGrid();
  state.stairs = { i: 3, j: 3 };
  state.exitLocked = false;
  state.zombies = [];
  state.vfx = null;
  state.shakeT = 0;
  state.hitstopT = 0;
  state.elapsed = 0;
  state.player = { x: 0, z: 0, hp: 6, momX: 0, momZ: 0, momSpeed: 0, iframes: 0, facing: "S" } as unknown as typeof state.player;
});

test("spawning the Reaper King seals the exit and rings it with skulls", () => {
  let king: Zombie | null = null;
  spawnBoss(state.grid!, { i: 3, j: 3 }, 220, (x, z, hp) => {
    king = fakeZombie(x, z, hp);
    state.zombies.push(king);
    return king;
  });

  expect(state.exitLocked).toBe(true);
  expect(bossActive()).toBe(true);
  expect(king).not.toBeNull();
  expect(king!.hp).toBeGreaterThan(100); // meaty, not a speed-bump
  // Five skulls were added to the scene as the orbiting ring.
  expect(state.scene!.children.length).toBeGreaterThanOrEqual(5);
});

test("a few ticks keep the exit sealed while the king lives", () => {
  spawnBoss(state.grid!, { i: 3, j: 3 }, 220, (x, z, hp) => {
    const k = fakeZombie(x, z, hp);
    state.zombies.push(k);
    return k;
  });
  for (let i = 0; i < 5; i++) updateBoss(0.1);
  expect(state.exitLocked).toBe(true);
  expect(bossActive()).toBe(true);
});

test("killing the Reaper King opens the portal and unlocks the exit", () => {
  let king: Zombie = fakeZombie(0, 0, 1);
  spawnBoss(state.grid!, { i: 3, j: 3 }, 220, (x, z, hp) => {
    king = fakeZombie(x, z, hp);
    state.zombies.push(king);
    return king;
  });
  expect(state.exitLocked).toBe(true);

  // Slay it: hp bottoms out and combat removes it from the horde.
  king.hp = 0;
  state.zombies = state.zombies.filter((z) => z !== king);

  updateBoss(0.016); // detects the death → opens the portal
  expect(state.exitLocked).toBe(false);
  expect(bossActive()).toBe(false);

  // The portal survives further ticks (it doesn't re-lock or vanish).
  for (let i = 0; i < 3; i++) updateBoss(0.1);
  expect(state.exitLocked).toBe(false);

  disposeBoss();
});
