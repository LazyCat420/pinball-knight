import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * A reinforcement is a real actor built from a real atlas onto a real canvas,
 * none of which node has. Only the spawn call is stubbed — the ramp, the
 * target, the placement band, the denominator bump and the corpse cull are all
 * the shipping code.
 */
vi.mock("./factory", () => ({
  spawnHordeMember: (_hash: number, x: number, z: number, speed: number) => fakeZombie({ x, z, speed }),
}));
vi.mock("../ui", () => ({ showToast: () => {} }));
vi.mock("../coop", () => ({ isReplica: () => false }));

import { armTide, pickSpawnTile, reapCorpses, tickTide, tideDemand, tideIntensity } from "./tide";
import { state } from "../state";
import type { Zombie } from "../state";
import {
  CORPSE_BUDGET,
  TIDE_GRACE,
  TIDE_RAMP,
  TIDE_SHARE_CALM,
  TIDE_SHARE_PEAK,
  TIDE_SPAWN_MAX_TILES,
  TIDE_SPAWN_MIN_TILES,
} from "../constants";
import { T_FLOOR, T_WALL, tileCenter, type Grid } from "../maze/generator";

/**
 * THE HOLE THIS FILE FILLS
 *
 * Every monster on a floor used to be placed at build time, and that was the
 * entire supply. Clear the horde and the maze was an empty museum for the rest
 * of the Death Dealer's 110-second fuse — nothing to farm, and a floor that got
 * SAFER the longer you stayed on it.
 *
 * The tide feeds it. The four properties below are the ones that stop that
 * from being a leak instead of a feature, and none of them is visible to tsc:
 *
 *   §ramp        it escalates, and it escalates on the Dealer's clock
 *   §ceiling     the live count never exceeds what the floor OPENED with
 *   §band        reinforcements walk in — they never surface next to you
 *   §denominator the grade's carnage share follows the supply
 *   §corpses     the litter is bounded, or the tide is an unbounded array
 */

/** A monster stub with just the fields the tide reads plus a parentable mesh. */
function fakeZombie(over: Partial<Zombie> = {}): Zombie {
  const mesh = { parent: null as null | { remove(o: unknown): void } };
  const z = {
    kind: "zombie",
    hp: 3,
    mode: "walk",
    speed: 1.5,
    aggro: false,
    x: 0,
    z: 0,
    sprite: { mesh },
    ...over,
  } as unknown as Zombie;
  return z;
}

/** A corpse that remembers whether it was unparented, so "left the scene" is a
 *  fact the test reads rather than an effect it trusts. */
function fakeCorpse(over: Partial<Zombie> = {}): Zombie & { unparented: boolean } {
  const z = fakeZombie({ mode: "dead", ...over }) as Zombie & { unparented: boolean };
  z.unparented = false;
  (z.sprite.mesh as unknown as { parent: unknown }).parent = {
    remove: () => {
      z.unparented = true;
    },
  };
  return z;
}

function fakeGrid(w = 81, h = 81): Grid {
  return { w, h, t: new Uint8Array(w * h).fill(T_FLOOR), shapes: new Uint8Array(w * h) };
}

beforeEach(() => {
  state.grid = fakeGrid();
  state.player = { x: 0, z: 0 } as unknown as typeof state.player;
  state.gameOver = false;
  state.level = 3;
  state.zombies = [];
  state.tideTiles = [];
  state.tideBase = 0;
  state.tideT = 0;
  state.tideStirred = false;
  state.levelT = 0;
  state.levelHordeSize = 0;
});

// ── §ramp ──────────────────────────────────────────────────────────
describe("the ramp", () => {
  it("is silent through the grace period, then climbs to full", () => {
    state.levelT = 0;
    expect(tideIntensity()).toBe(0);
    state.levelT = TIDE_GRACE;
    expect(tideIntensity()).toBe(0);
    state.levelT = TIDE_GRACE + TIDE_RAMP / 2;
    expect(tideIntensity()).toBeCloseTo(0.5, 5);
    state.levelT = TIDE_GRACE + TIDE_RAMP;
    expect(tideIntensity()).toBe(1);
  });

  it("clamps at full rather than overshooting once the Dealer is out", () => {
    state.levelT = 600;
    expect(tideIntensity()).toBe(1);
  });

  it("wants more monsters, and wants them sooner, as the floor ages", () => {
    state.tideBase = 100;
    const at = (t: number) => {
      state.levelT = t;
      return tideDemand();
    };
    const early = at(TIDE_GRACE + 1);
    const late = at(TIDE_GRACE + TIDE_RAMP);
    expect(late.target).toBeGreaterThan(early.target);
    expect(late.pulse).toBeGreaterThan(early.pulse);
  });

  it("spawns nothing at all before the grace period is up", () => {
    state.tideBase = 100;
    state.tideTiles = [{ i: 60, j: 40 }];
    state.levelT = TIDE_GRACE - 0.1;
    tickTide(1);
    expect(state.zombies).toHaveLength(0);
  });
});

// ── §ceiling ───────────────────────────────────────────────────────
describe("the population ceiling", () => {
  it("snapshots the WHOLE opening population, packs and pins included", () => {
    // armTide is called from the very bottom of populateFloor for this reason:
    // the horde array is assigned early, but boss, pin crews, guards, spine
    // packs and plaza packs all push onto it afterwards. Arm any earlier and
    // the tide refills toward a smaller floor than the one you walked into.
    state.zombies = Array.from({ length: 30 }, () => fakeZombie()); // baseline horde
    state.zombies.push(...Array.from({ length: 14 }, () => fakeZombie())); // …then the packs
    armTide([{ i: 1, j: 1 }]);
    expect(state.tideBase).toBe(44);
    expect(state.tideTiles).toHaveLength(1);
    expect(state.tideStirred).toBe(false);
  });

  it("never asks for more than the floor opened with", () => {
    state.tideBase = 137;
    for (let t = TIDE_GRACE; t <= TIDE_GRACE + TIDE_RAMP + 60; t += 1) {
      state.levelT = t;
      expect(tideDemand().target).toBeLessThanOrEqual(state.tideBase);
    }
  });

  it("holds its fire while the opening horde is still standing", () => {
    state.tideBase = 40;
    state.zombies = Array.from({ length: 40 }, () => fakeZombie());
    state.levelT = TIDE_GRACE + TIDE_RAMP; // peak intensity, full floor
    expect(tideDemand().pulse).toBe(0);
  });

  it("refills only the deficit, never past the target", () => {
    state.tideBase = 100;
    state.levelT = TIDE_GRACE + TIDE_RAMP;
    state.zombies = Array.from({ length: 99 }, () => fakeZombie());
    const d = tideDemand();
    expect(d.target).toBe(Math.round(100 * TIDE_SHARE_PEAK));
    expect(d.pulse).toBe(1); // one short, so one — not a whole pulse
  });

  it("counts corpses as dead, not as population", () => {
    state.tideBase = 20;
    state.levelT = TIDE_GRACE;
    state.zombies = Array.from({ length: 20 }, () => fakeCorpse());
    expect(tideDemand().live).toBe(0);
    expect(tideDemand().target).toBe(Math.round(20 * TIDE_SHARE_CALM));
    expect(tideDemand().pulse).toBeGreaterThan(0);
  });
});

// ── §band ──────────────────────────────────────────────────────────
describe("where reinforcements come in", () => {
  it("never surfaces one inside the knight's aggro ring", () => {
    const g = state.grid!;
    // Every tile on the floor is a candidate — including the ones underfoot.
    for (let j = 1; j < g.h - 1; j += 3) for (let i = 1; i < g.w - 1; i += 3) state.tideTiles.push({ i, j });
    for (let n = 0; n < 400; n++) {
      const spot = pickSpawnTile();
      expect(spot).not.toBeNull();
      const d = Math.hypot(spot!.x - state.player!.x, spot!.z - state.player!.z);
      expect(d).toBeGreaterThanOrEqual(TIDE_SPAWN_MIN_TILES);
      expect(d).toBeLessThanOrEqual(TIDE_SPAWN_MAX_TILES);
    }
  });

  it("skips the pulse rather than spawning in your lap when nothing is far enough", () => {
    const g = state.grid!;
    const here = { i: Math.floor(g.w / 2), j: Math.floor(g.h / 2) }; // the player's own tile
    state.tideTiles = [here, { i: here.i + 1, j: here.j }, { i: here.i, j: here.j + 2 }];
    expect(pickSpawnTile()).toBeNull();

    state.tideBase = 50;
    state.levelT = TIDE_GRACE + TIDE_RAMP;
    tickTide(1);
    expect(state.zombies).toHaveLength(0);
  });

  it("reaches past the band, to the NEAREST tile, rather than starve", () => {
    // 2-4% of standable tiles on the shipping floors have no spawn tile inside
    // the band at all, always because they are too FAR (tide-reach.test.ts).
    // Without this the tide switches off in the far corners of deep floors.
    state.grid = fakeGrid(161, 161); // room to put a tile well outside the band
    const g = state.grid;
    const c = { i: Math.floor(g.w / 2), j: Math.floor(g.h / 2) };
    const far = TIDE_SPAWN_MAX_TILES + 4;
    const further = TIDE_SPAWN_MAX_TILES + 9;
    state.tideTiles = [
      { i: c.i + further, j: c.j },
      { i: c.i + far, j: c.j }, // the nearest of the two — the one to take
    ];
    const spot = pickSpawnTile();
    expect(spot).not.toBeNull();
    expect(Math.hypot(spot!.x - state.player!.x, spot!.z - state.player!.z)).toBeCloseTo(far, 5);
  });

  it("prefers the band whenever the band has anything in it", () => {
    state.grid = fakeGrid(161, 161);
    const g = state.grid;
    const c = { i: Math.floor(g.w / 2), j: Math.floor(g.h / 2) };
    state.tideTiles = [
      { i: c.i + TIDE_SPAWN_MAX_TILES + 6, j: c.j }, // out past the band
      { i: c.i + TIDE_SPAWN_MIN_TILES + 2, j: c.j }, // inside it
    ];
    for (let n = 0; n < 50; n++) {
      const spot = pickSpawnTile()!;
      const d = Math.hypot(spot.x - state.player!.x, spot.z - state.player!.z);
      expect(d).toBeLessThanOrEqual(TIDE_SPAWN_MAX_TILES);
    }
  });

  it("ignores a tile the floor has since walled off", () => {
    const g = state.grid!;
    const far = { i: Math.floor(g.w / 2) + 20, j: Math.floor(g.h / 2) };
    state.tideTiles = [far];
    expect(pickSpawnTile()).not.toBeNull();
    g.t[far.j * g.w + far.i] = T_WALL;
    expect(pickSpawnTile()).toBeNull();
  });
});

// ── §denominator ───────────────────────────────────────────────────
describe("what the tide does to the floor grade", () => {
  it("adds every reinforcement to the carnage denominator", () => {
    const g = state.grid!;
    state.tideTiles = [{ i: Math.floor(g.w / 2) + 20, j: Math.floor(g.h / 2) }];
    state.tideBase = 100;
    state.levelHordeSize = 100;
    state.levelT = TIDE_GRACE + TIDE_RAMP;
    tickTide(1);
    expect(state.zombies.length).toBeGreaterThan(0);
    // Without this, farming a tide walks kills/levelHordeSize past 1.0 and
    // every farmed floor grades S on carnage for free.
    expect(state.levelHordeSize).toBe(100 + state.zombies.length);
  });

  it("brings them in already hunting", () => {
    const g = state.grid!;
    state.tideTiles = [{ i: Math.floor(g.w / 2) + 20, j: Math.floor(g.h / 2) }];
    state.tideBase = 100;
    state.levelT = TIDE_GRACE + TIDE_RAMP;
    tickTide(1);
    expect(state.zombies.every((z) => z.aggro)).toBe(true);
  });

  it("waits out its interval between pulses", () => {
    const g = state.grid!;
    state.tideTiles = [{ i: Math.floor(g.w / 2) + 20, j: Math.floor(g.h / 2) }];
    state.tideBase = 100;
    state.levelT = TIDE_GRACE + TIDE_RAMP;
    tickTide(1);
    const afterFirst = state.zombies.length;
    tickTide(0.016); // next frame — the interval has not elapsed
    expect(state.zombies).toHaveLength(afterFirst);
  });
});

// ── §corpses ───────────────────────────────────────────────────────
describe("the corpse budget", () => {
  it("bounds the litter and leaves the living alone", () => {
    const living = Array.from({ length: 12 }, () => fakeZombie());
    const dead = Array.from({ length: CORPSE_BUDGET + 30 }, () => fakeCorpse());
    state.zombies = [...dead, ...living];
    reapCorpses();
    expect(state.zombies.filter((z) => z.mode === "dead")).toHaveLength(CORPSE_BUDGET);
    expect(state.zombies.filter((z) => z.mode !== "dead")).toHaveLength(12);
  });

  it("culls oldest-first, so the kills you just made stay where you made them", () => {
    const dead = Array.from({ length: CORPSE_BUDGET + 5 }, (_, n) => fakeCorpse({ hp: -n }));
    state.zombies = [...dead];
    reapCorpses();
    // hp carries the birth order; the five lowest indices are the ones gone.
    const kept = state.zombies.map((z) => z.hp);
    expect(kept).toEqual(dead.slice(5).map((z) => z.hp));
    expect(dead.slice(0, 5).every((z) => z.unparented)).toBe(true);
  });

  it("keeps a slain boss — the portal blooms over the body", () => {
    const boss = fakeCorpse({ boss: true });
    state.zombies = [boss, ...Array.from({ length: CORPSE_BUDGET + 20 }, () => fakeCorpse())];
    reapCorpses();
    expect(state.zombies).toContain(boss);
    expect(boss.unparented).toBe(false);
  });

  it("does nothing at all under budget", () => {
    state.zombies = Array.from({ length: CORPSE_BUDGET }, () => fakeCorpse());
    reapCorpses();
    expect(state.zombies).toHaveLength(CORPSE_BUDGET);
  });
});
