/**
 * THE CROAKER'S HOP — the two rules that make it the only thing in the game
 * that does not respect the maze.
 *
 *   1. Airborne, it crosses a KNEE-HIGH wall. Every other monster is a prisoner
 *      of the corridor graph.
 *   2. Airborne, a FULL-HEIGHT wall does not stop it — it turns it. So a croaker
 *      arrives on a vector nothing else can, and a corner is worse than open
 *      floor against this one.
 *
 * Both are exceptions to `moveCircle`, i.e. to collision rather than to
 * steering, which is why they live in a bespoke branch instead of a movement
 * policy — and why they are worth pinning here. A regression in either does not
 * crash or fail any other test; the frog just quietly becomes a slow spitter.
 *
 * `isLowWall` gets its own tests because it is now read by BOTH the renderer
 * (maze/build.ts, which decides the wall's height on screen) and this hop. If
 * those two ever disagree, a frog sails over a wall the player watched being
 * drawn full-height, which reads as a straightforward bug.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { state, freshPlayerFields } from "../state";
import { updateZombies } from "./zombie";
import { isLowWall, T_FLOOR, T_WALL, idx } from "../maze/generator";
import type { Grid } from "../maze/generator";
import { CROAKER_HOP_MIN_RANGE, CROAKER_HOP_BOUNCES, FIXED_STEP } from "../constants";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const W = 21;

/** An all-floor grid. World coords are centred: tile (i,j) ↔ x = i - w/2 + 0.5. */
function openGrid(): Grid {
  const t = new Uint8Array(W * W).fill(T_FLOOR);
  return { w: W, h: W, t, shapes: new Uint8Array(W * W) } as Grid;
}
const setWall = (g: Grid, i: number, j: number): void => { g.t[idx(g, i, j)] = T_WALL; };
/** Tile index → world centre, matching engine/grid.ts tileCenter. */
const wx = (i: number): number => i - W / 2 + 0.5;

function fakeCroaker(x: number, z: number): Any {
  return {
    kind: "croaker",
    hp: 10, maxHp: 10, mode: "chase", x, z, speed: 2,
    windupT: 0, cooldown: 99, // never fire — this test is about the hop
    dotT: 0, dotDmg: 0, dotTickT: 0, chillT: 0, flashT: 0, burnT: 0,
    aggro: true, stagger: 0, painT: 0, knockT: 0, kbx: 0, kbz: 0,
    hopT: 0, hopCd: 0, hopBounces: 0,
    sprite: { setTint() {}, mesh: { position: { set() {} } } },
    anim: { play() {}, setFacing() {}, setRate() {} },
    mesh: { position: { set() {} } },
  };
}

beforeEach(() => {
  state.grid = openGrid();
  state.player = { x: 0, z: 0, ...freshPlayerFields() } as Any;
  state.player!.hp = 10;
  state.zombies = [];
  state.vfx = undefined as never;
  state.flowField = null;
});

/** Step the sim until `done`, or give up. Returns the steps taken. */
function stepUntil(done: () => boolean, max = 240): number {
  for (let n = 1; n <= max; n++) {
    updateZombies(FIXED_STEP);
    if (done()) return n;
  }
  return -1;
}

describe("isLowWall", () => {
  it("is a wall tile with floor to its NORTH or WEST — the camera-side rim", () => {
    const g = openGrid();
    setWall(g, 10, 10);
    // floor at (10,9) north and (9,10) west → camera-side rim, knee-high
    expect(isLowWall(g, 10, 10)).toBe(true);
    // bury it: no floor north or west → full height
    setWall(g, 10, 9);
    setWall(g, 9, 10);
    expect(isLowWall(g, 10, 10)).toBe(false);
  });

  it("is false for floor — a tile you can already walk on is not a wall to hop", () => {
    const g = openGrid();
    expect(isLowWall(g, 10, 10)).toBe(false);
  });
});

describe("a croaker hopping toward the player", () => {
  it("crosses a KNEE-HIGH wall that stops everything else", () => {
    const g = state.grid!;
    // A one-tile rim at i=12 with floor to its west (i=11) → low.
    setWall(g, 12, 10);
    expect(isLowWall(g, 12, 10), "the test's own wall is not knee-high").toBe(true);

    // Frog west of the wall, player east of it, far enough apart to hop.
    const z = fakeCroaker(wx(10), wx(10));
    state.zombies = [z];
    state.player!.x = wx(15);
    state.player!.z = wx(10);
    expect(Math.hypot(state.player!.x - z.x, 0)).toBeGreaterThan(CROAKER_HOP_MIN_RANGE);

    const steps = stepUntil(() => z.x > wx(12) + 0.5);
    expect(steps, "the croaker never got past the knee-high wall").toBeGreaterThan(0);
  });

  it("does NOT cross a full-height wall — it bounces back off it", () => {
    const g = state.grid!;
    // Bury the same tile so it renders (and behaves) full height.
    setWall(g, 12, 10);
    setWall(g, 12, 9);
    setWall(g, 11, 10);
    expect(isLowWall(g, 12, 10)).toBe(false);

    const z = fakeCroaker(wx(9), wx(10));
    const startX = z.x;
    state.zombies = [z];
    state.player!.x = wx(15);
    state.player!.z = wx(10);

    // Run well past a full hop's duration.
    for (let n = 0; n < 240; n++) updateZombies(FIXED_STEP);
    expect(z.x, "the croaker walked through full masonry").toBeLessThan(wx(12) - 0.2);
    // And it did not merely stop dead at the wall: at least one ricochet was
    // spent turning it. Asserting the budget reached ZERO would be wrong — a
    // hop that bounces once and then runs out its airtime is the common case,
    // and requiring both bounces would pin the arc geometry rather than the
    // rule.
    expect(z.hopBounces ?? CROAKER_HOP_BOUNCES).toBeLessThan(CROAKER_HOP_BOUNCES);
    expect(Number.isFinite(z.x) && Number.isFinite(z.z)).toBe(true);
    expect(z.x).not.toBe(startX);
  });

  it("stays inside the map — a hop cannot escape the grid", () => {
    // Aim it at the boundary and let it bounce as long as it likes.
    const z = fakeCroaker(wx(2), wx(2));
    state.zombies = [z];
    state.player!.x = wx(0);
    state.player!.z = wx(0);
    for (let n = 0; n < 600; n++) updateZombies(FIXED_STEP);
    expect(z.x).toBeGreaterThan(-W / 2);
    expect(z.x).toBeLessThan(W / 2);
    expect(z.z).toBeGreaterThan(-W / 2);
    expect(z.z).toBeLessThan(W / 2);
  });

  it("does not hop when the player is already close — the leap is for CROSSING", () => {
    const z = fakeCroaker(0.6, 0);
    state.zombies = [z];
    state.player!.x = 0;
    state.player!.z = 0;
    for (let n = 0; n < 30; n++) updateZombies(FIXED_STEP);
    expect(z.hopT ?? 0).toBe(0);
  });
});
