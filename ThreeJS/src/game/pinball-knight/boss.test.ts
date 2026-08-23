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

// ── THE LEASH ─────────────────────────────────────────────────────────────
//
// The king is a GUARDIAN of the exit, and the bug these pin is that he was not
// one: `spawnBoss` set `aggro = true`, the flag the generic zombie AI reads to
// decide whether to chase, so from the frame the floor existed he walked toward
// the spawn and never stopped. A census said his spawn TILE is never nearer
// than 56 BFS steps from the player's — placement was never the problem, so no
// generation rule could have fixed it.
//
// `state.flowField` is BFS distance FROM THE PLAYER, read at the king's tile —
// the same quantity the grunt aggro gate uses. These tests write it directly,
// which is what makes the leash testable without a real floor.

/**
 * An OPEN hall big enough to walk a leash across.
 *
 * `makeGrid()` above is 7x7 of zeroes, and a zeroed tile array is all T_WALL
 * (maze/generator.ts says so where it allocates one) — so `moveCircle` is right
 * to refuse to move anything in it. The walk-home test needs real floor and
 * needs it to be wider than KING_LEASH_TILES, or the leash can never be crossed
 * without leaving the grid entirely.
 */
const HALL = 90;
function openHall(): Grid {
  const t = new Uint8Array(HALL * HALL).fill(1); // 1 = T_FLOOR (engine/grid.ts)
  return { w: HALL, h: HALL, t, shapes: new Uint8Array(HALL * HALL) };
}

/** A flow field over the CURRENT `state.grid` reporting `d` at every tile. */
function flatField(d: number): Int32Array {
  const g = state.grid!;
  return new Int32Array(g.w * g.h).fill(d);
}

function spawnKing(at: { i: number; j: number } = { i: 3, j: 3 }): Zombie {
  let king: Zombie | null = null;
  spawnBoss(state.grid!, at, 220, (x, z, hp) => {
    king = fakeZombie(x, z, hp);
    state.zombies.push(king);
    return king;
  });
  return king!;
}

test("the king does NOT aggro on spawn — he holds his post until you come near", () => {
  state.flowField = flatField(120); // player is right across the floor
  const king = spawnKing();
  expect(king.aggro, "aggro'd before anyone was near him").toBe(false);
  updateBoss(0.1);
  expect(king.aggro, "a tick woke him with the player 120 tiles away").toBe(false);
});

test("he engages once the player is inside his wake radius", () => {
  state.flowField = flatField(120);
  const king = spawnKing();
  updateBoss(0.1);
  expect(king.aggro).toBe(false);
  state.flowField = flatField(8); // the player walks into his hall
  updateBoss(0.1);
  expect(king.aggro, "the player is 8 tiles away and he ignored them").toBe(true);
});

test("dragged off his post, he disengages and walks back to it", () => {
  state.grid = openHall();
  state.flowField = flatField(4);
  const king = spawnKing({ i: HALL / 2, j: HALL / 2 });
  updateBoss(0.1);
  expect(king.aggro).toBe(true);

  // Kite him past the leash. The player stays adjacent the whole time — this is
  // the case a naive "disengage when the player is far" rule misses entirely,
  // and it is the one that actually happens: you fight him, back away down a
  // corridor, and he follows you off the exit he is supposed to be guarding.
  const homeX = king.x;
  const homeZ = king.z;
  king.x = homeX + 40;
  king.z = homeZ;
  updateBoss(0.1);
  expect(king.aggro, "still hunting from well outside his leash").toBe(false);

  // …and he closes on the anchor rather than standing where he gave up.
  const before = Math.hypot(king.x - homeX, king.z - homeZ);
  for (let i = 0; i < 20; i++) updateBoss(0.1);
  const after = Math.hypot(king.x - homeX, king.z - homeZ);
  expect(after, `did not walk home (${before.toFixed(1)} → ${after.toFixed(1)})`).toBeLessThan(before);
});

test("a disengaged king fires NO skull barrage — the leash removes the harassment too", () => {
  state.flowField = flatField(120);
  const king = spawnKing();
  const meshes = () => state.scene!.children.length;
  const base = meshes();
  // Well past BARRAGE_INTERVAL: an engaged king would have thrown several bones,
  // each of which adds a mesh to the scene.
  for (let i = 0; i < 60; i++) updateBoss(0.2);
  expect(meshes(), "threw bones at a player it had not even noticed").toBe(base);
  expect(king.aggro).toBe(false);
});

test("the wake radius is strictly inside the leash, or he oscillates", () => {
  // Not a behaviour test — a TUNING invariant. With LEASH <= WAKE the king
  // wakes, steps forward, trips the leash, returns, and wakes again on the spot:
  // a boss that vibrates. Pinned here because the two constants live apart from
  // each other and nothing else would catch the inversion.
  state.flowField = flatField(120);
  const king = spawnKing();
  const homeX = king.x;
  state.flowField = flatField(1); // player on top of him
  updateBoss(0.1);
  expect(king.aggro).toBe(true);
  // Walk him out to just under the leash; he must STILL be engaged there.
  king.x = homeX + 30;
  updateBoss(0.1);
  expect(king.aggro, "gave up inside his own leash — WAKE/LEASH are inverted").toBe(true);
});
