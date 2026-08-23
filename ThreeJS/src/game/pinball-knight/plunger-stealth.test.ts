/**
 * THE CHUTE IS COVER — nothing acquires the knight until the ball is in play.
 *
 * The bug this pins: a floor opens with the knight PARKED in the plunger chute,
 * and every acquisition check in the game measures against the knight's current
 * position. The aggro radius is floor-relative and therefore large
 * (`aggroTiles`, up to 0.75× the grid diagonal), so while the player sat at the
 * plunger choosing an aim line, the entire reachable horde woke up and walked to
 * the chute. Launch into a reception committee, every floor. Worse, the parked
 * knight cannot move — `updatePlunger` owns the player and returns early — so
 * there is no way to decline the invitation.
 *
 * Reported from play: "when we start the monsters shouldn't be able to see the
 * user until they launch from the starting point — that way they don't all go to
 * where the user is if they are idle at the start of the maze."
 *
 * Note WHAT is asserted: the gate is a PERCEPTION gate, not a freeze. A monster
 * that is already hunting keeps hunting; only the acquisition transition
 * (`aggro` false → true) is withheld. That distinction is the reason the test
 * checks a pre-aggroed monster still moves — a "just skip updateZombies while
 * parked" implementation passes the first test and fails that one, and would
 * also stall wind-ups, burn ticks and stagger recovery mid-flight.
 *
 * tsc cannot catch a regression here: `plungerArmed` and `aggro` are both plain
 * booleans and dropping the gate is a *deletion*, which nothing goes red over.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { state, freshPlayerFields, playerIsVisibleToEnemies } from "./state";
import { updateZombies } from "./entities/zombie";
import { hordeFlowField } from "./engine/flow-field";
import { T_FLOOR, idx, worldToTile, type Grid } from "./maze/generator";
import { aggroTiles, FIXED_STEP, MIMIC_WAKE_RANGE } from "./constants";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const W = 41;

/** An all-floor grid. World coords are centred: tile (i,j) ↔ x = i - w/2 + 0.5. */
function openGrid(): Grid {
  return { w: W, h: W, t: new Uint8Array(W * W).fill(T_FLOOR), shapes: new Uint8Array(W * W) } as Grid;
}

/** A plain grunt, close enough that the aggro radius plainly covers it. */
function fakeZombie(x: number, z: number, over: Partial<Any> = {}): Any {
  return {
    kind: "zombie",
    hp: 10, maxHp: 10, mode: "idle", x, z, speed: 2,
    windupT: 0, cooldown: 99, // never swing — this test is about noticing you
    dotT: 0, dotDmg: 0, dotTickT: 0, chillT: 0, flashT: 0, burnT: 0,
    aggro: false, staggerT: 0, painT: 0, knockT: 0, kbx: 0, kbz: 0,
    sprite: { setTint() {}, mesh: { position: { set() {} } } },
    anim: { play() {}, setFacing() {}, setRate() {} },
    mesh: { position: { set() {} } },
    ...over,
  };
}

beforeEach(() => {
  const g = openGrid();
  state.grid = g;
  state.player = { x: 0, z: 0, ...freshPlayerFields() } as Any;
  state.player!.hp = 10;
  state.zombies = [];
  state.vfx = undefined as never;
  // One BFS seeded from the knight, exactly as sim/simulate.ts does it.
  const pt = worldToTile(g, 0, 0);
  state.flowField = hordeFlowField(g, pt.i, pt.j);
  state.plungerArmed = false;
});

/** Path distance from the knight to a world position, per the horde's own field. */
function pathDist(x: number, z: number): number {
  const g = state.grid!;
  const t = worldToTile(g, x, z);
  return state.flowField![idx(g, t.i, t.j)];
}

describe("the plunger chute hides the knight", () => {
  it("the setup is honest: this monster IS inside the aggro radius", () => {
    // Guard the sample. If the fixture ever drifts out of range the "does not
    // aggro" test below would pass for the wrong reason — it would be pinning
    // the radius, not the gate. Cf. the aggro-radius regression itself.
    expect(pathDist(6, 0)).toBeLessThanOrEqual(aggroTiles(W, W));
    expect(pathDist(6, 0)).toBeGreaterThan(0);
  });

  it("does not wake a monster standing well inside the aggro radius", () => {
    state.plungerArmed = true;
    const z = fakeZombie(6, 0);
    state.zombies = [z];
    for (let n = 0; n < 30; n++) updateZombies(FIXED_STEP);
    expect(z.aggro, "a parked knight has not been seen yet").toBe(false);
    expect(z.mode).toBe("idle");
    expect(Math.hypot(z.x - 6, z.z - 0), "it should not have taken a step").toBeLessThan(1e-6);
  });

  it("wakes that same monster the instant the plunger fires", () => {
    // Same fixture, same frames — the ONLY difference is the parked flag, which
    // is what makes this an A/B on the gate rather than on the radius.
    state.plungerArmed = true;
    const z = fakeZombie(6, 0);
    state.zombies = [z];
    updateZombies(FIXED_STEP);
    expect(z.aggro).toBe(false); // still parked

    state.plungerArmed = false; // ← the launch
    updateZombies(FIXED_STEP);
    expect(z.aggro, "the ball is in play; the floor wakes").toBe(true);
  });

  it("holds a mimic sited next to the chute instead of bursting on a parked knight", () => {
    state.plungerArmed = true;
    const near = MIMIC_WAKE_RANGE * 0.5;
    const m = fakeZombie(near, 0, { kind: "mimic", dormant: true });
    state.zombies = [m];
    for (let n = 0; n < 30; n++) updateZombies(FIXED_STEP);
    expect(m.dormant, "you didn't step close — the floor opened with you there").toBe(true);
    expect(m.aggro).toBe(false);

    state.plungerArmed = false;
    updateZombies(FIXED_STEP);
    expect(m.dormant, "in play, a mimic in your lap still bursts").toBe(false);
  });

  it("is a PERCEPTION gate, not a freeze: an already-hunting monster keeps hunting", () => {
    // The failure mode this exists to catch: gating by skipping the horde
    // update while parked. That passes every test above and quietly stalls
    // every other timer on every monster.
    state.plungerArmed = true;
    const z = fakeZombie(6, 0, { aggro: true, mode: "chase" });
    state.zombies = [z];
    for (let n = 0; n < 30; n++) updateZombies(FIXED_STEP);
    expect(z.aggro).toBe(true);
    expect(Math.hypot(z.x - 6, z.z - 0), "it was already hunting; it closes in").toBeGreaterThan(0.05);
  });

  it("exposes the rule as one predicate, so every acquisition path can read the same flag", () => {
    state.plungerArmed = true;
    expect(playerIsVisibleToEnemies()).toBe(false);
    state.plungerArmed = false;
    expect(playerIsVisibleToEnemies()).toBe(true);
  });
});
