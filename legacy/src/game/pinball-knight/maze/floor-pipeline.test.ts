/**
 * WHOLE-FLOOR integration test: runs the exact sequence core.ts startLevel uses
 * — archetype seeds → maze → rooms → landmark → prefabs → secrets → thicken →
 * widen artery → decorate — across many depths and seeds.
 *
 * The unit tests pin each stage in isolation; this one catches the thing they
 * can't: a stage ORDERING mistake, or an archetype whose shape only breaks once
 * rooms and stamps have also been carved over it. A floor that fails here is a
 * floor a player would spawn into and be unable to finish.
 */
import { describe, it, expect } from "vitest";
import { generateMaze, thickenWalls, carveRooms, crackSecretWalls, mulberry32, at, idx, T_FLOOR, T_STAIRS } from "./generator";
import { decorateMaze, widenMainArtery, pickEndpoints } from "./decorate";
import { stampPrefabs, stampLandmark, pickFocusCells, themeFor } from "./prefabs";
import { archetypeFor } from "./archetypes";
import { rollModifier } from "./modifiers";
import { bfsDistances } from "../entities/ai";

const ROOM_MIN_CELLS = 3;
const ROOM_MAX_CELLS = 6;

/** Mirrors core.ts startLevel's build order exactly. */
function buildFloor(level: number, runSeed: number) {
  const rng = mulberry32((runSeed ^ (level * 0x9e3779b9)) >>> 0);
  const l = Math.max(1, level);
  const cellsW = Math.min(17 + Math.ceil(l * 1.4), 33);
  const cellsH = Math.min(12 + l, 25);
  const floorTiles = cellsW * cellsH * 8;
  const braid = Math.min(0.14 + 0.04 * l, 0.4);
  const windiness = [1.0, 0.3, 0.65][(l - 1) % 3];

  const arch = archetypeFor(level);
  const modifier = rollModifier(level, rng);
  const raw = generateMaze(cellsW, cellsH, rng, braid * arch.braidMult, windiness, {
    seeds: arch.seeds(cellsW, cellsH, rng) ?? undefined,
    solidSeeds: arch.solid,
    braidGradient: arch.braidGradient,
  });
  const rawRooms = carveRooms(raw, rng, 3, ROOM_MIN_CELLS, ROOM_MAX_CELLS);
  const theme = themeFor(level);
  const landmark = stampLandmark(raw, rng, theme);
  const focus = pickFocusCells(raw, rng);
  const prefabCount = Math.min(3 + Math.floor((level - 1) / 2), 6);
  const stamped = stampPrefabs(raw, rng, prefabCount, theme, landmark.claimed, focus);
  crackSecretWalls(raw, rng, 4);
  const grid = thickenWalls(raw);
  const endpoints = pickEndpoints(grid, rng);
  if (endpoints) widenMainArtery(grid, endpoints);

  const rooms = rawRooms.map((r) => ({ i0: r.i0 * 2, j0: r.j0 * 2, w: r.w * 2, h: r.h * 2 }));
  const anchors = [...landmark.anchors, ...stamped.anchors].map((a) => ({ i: a.i * 2, j: a.j * 2, kind: a.kind }));
  const zombies = Math.max(1, Math.round(Math.min(Math.round(floorTiles / 32) + 3 * (l - 1), 60) * modifier.hordeMult));
  const torches = Math.max(4, Math.round(Math.min(Math.round(floorTiles / 55) + 8, 40) * modifier.torchMult));
  const partBudget = Math.max(4, Math.round(Math.min(14 + (level - 1) * 2, 34) * modifier.partMult));

  const plan = decorateMaze(grid, rng, zombies, torches, partBudget, rooms, {
    anchors,
    deal: modifier.dealBias.length ? ([...modifier.dealBias, ...theme.deal] as typeof theme.deal) : theme.deal,
    targets: 3,
    trapdoors: Math.round(2 * modifier.trapdoorMult),
    hazards: Math.round(6 * modifier.hazardMult),
    bonusItems: modifier.bonusItems,
    endpoints: endpoints ?? undefined,
  });
  return { grid, plan, arch, modifier, theme, landmark, stamped, endpoints };
}

const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 17, 20, 21, 25, 30, 40];
const RUN_SEEDS = [1, 12345, 0xc0ffee, 987654321];

describe("whole-floor pipeline", () => {
  it("every depth on every run seed is buildable and solvable start→stairs", () => {
    for (const runSeed of RUN_SEEDS) {
      for (const level of LEVELS) {
        const { grid, plan } = buildFloor(level, runSeed);
        const label = `L${level} run ${runSeed}`;
        // The stairs must exist and be reachable from the spawn — the one
        // failure mode that would strand a player mid-run.
        const dist = bfsDistances(grid, plan.start.i, plan.start.j);
        expect(at(grid, plan.stairs.i, plan.stairs.j), `${label}: stairs missing`).toBe(T_STAIRS);
        expect(dist[idx(grid, plan.stairs.i, plan.stairs.j)], `${label}: stairs unreachable`).toBeGreaterThanOrEqual(0);
        // And every floor tile is reachable, so no loot or enemy is walled off.
        for (let j = 0; j < grid.h; j++) {
          for (let i = 0; i < grid.w; i++) {
            if (at(grid, i, j) === T_FLOOR) {
              expect(dist[idx(grid, i, j)], `${label}: tile ${i},${j} stranded`).toBeGreaterThanOrEqual(0);
            }
          }
        }
      }
    }
  });

  it("every floor gets its set piece and a usable amount of content", () => {
    for (const runSeed of RUN_SEEDS) {
      for (const level of LEVELS) {
        const { plan, landmark, theme } = buildFloor(level, runSeed);
        const label = `L${level} run ${runSeed}`;
        expect(landmark.stamped.length, `${label}: no landmark`).toBe(1);
        expect(theme.landmarks).toContain(landmark.stamped[0]);
        expect(plan.spawns.length, `${label}: no horde`).toBeGreaterThan(0);
        expect(plan.torches.length, `${label}: no torches`).toBeGreaterThan(0);
        expect(plan.parts.length, `${label}: no pinball furniture`).toBeGreaterThan(0);
        expect(plan.items.length, `${label}: no loot`).toBeGreaterThan(0);
      }
    }
  });

  it("a modifier never starves a floor of light or furniture", () => {
    // The floors on the harsh end of the roll (Blackout halves torches,
    // Collapsing cuts them too) must still be playable.
    for (const runSeed of [7, 77, 777, 7777, 77777]) {
      for (let level = 3; level <= 24; level++) {
        const { plan, modifier } = buildFloor(level, runSeed);
        if (modifier.id === "none") continue;
        const label = `L${level} run ${runSeed} (${modifier.id})`;
        expect(plan.torches.length, `${label}: too dark`).toBeGreaterThanOrEqual(4);
        expect(plan.parts.length, `${label}: no furniture`).toBeGreaterThanOrEqual(4);
        expect(plan.spawns.length, `${label}: empty floor`).toBeGreaterThan(0);
      }
    }
  });

  it("is fully deterministic — same run seed and depth rebuild identically", () => {
    for (const level of [1, 6, 14, 23]) {
      const a = buildFloor(level, 424242);
      const b = buildFloor(level, 424242);
      expect(Array.from(a.grid.t), `L${level} grid`).toEqual(Array.from(b.grid.t));
      expect(a.plan.stairs).toEqual(b.plan.stairs);
      expect(a.plan.spawns.length).toBe(b.plan.spawns.length);
      expect(a.modifier.id).toBe(b.modifier.id);
      expect(a.landmark.stamped).toEqual(b.landmark.stamped);
    }
  });

  it("the exit is not pinned to one corner", () => {
    // The reported bug: level 1's stairs were ALWAYS bottom-right. Not an rng
    // failure — start was "first floor tile from the top-left" and stairs was
    // the single farthest tile from it, which on a rectangular grid is always
    // the opposite corner. The rng was never consulted for either.
    const quadrantOf = (p: { i: number; j: number }, w: number, h: number): string =>
      `${p.i < w / 2 ? "L" : "R"}${p.j < h / 2 ? "T" : "B"}`;

    // Level 1 specifically, across many runs — this is what the player saw.
    const seen = new Map<string, number>();
    for (let runSeed = 1; runSeed <= 40; runSeed++) {
      const { grid, plan } = buildFloor(1, runSeed * 7919);
      const q = quadrantOf(plan.stairs, grid.w, grid.h);
      seen.set(q, (seen.get(q) ?? 0) + 1);
    }
    // All four quadrants should show up, and none should dominate outright.
    expect(seen.size, `level 1 exit quadrants: ${JSON.stringify([...seen])}`).toBe(4);
    for (const [q, n] of seen) {
      expect(n, `quadrant ${q} dominates: ${JSON.stringify([...seen])}`).toBeLessThan(30);
    }
  });

  it("the exit is still a genuine trek from the spawn", () => {
    // Randomising the exit must not turn it into "the stairs are 3 tiles away".
    for (const runSeed of RUN_SEEDS) {
      for (const level of LEVELS) {
        const { grid, plan } = buildFloor(level, runSeed);
        const dist = bfsDistances(grid, plan.start.i, plan.start.j);
        let maxDist = 0;
        for (let j = 0; j < grid.h; j++) {
          for (let i = 0; i < grid.w; i++) {
            if (at(grid, i, j) === T_FLOOR || at(grid, i, j) === T_STAIRS) {
              maxDist = Math.max(maxDist, dist[idx(grid, i, j)]);
            }
          }
        }
        const d = dist[idx(grid, plan.stairs.i, plan.stairs.j)];
        expect(d, `L${level} run ${runSeed}: exit too close (${d} of ${maxDist})`).toBeGreaterThanOrEqual(maxDist * 0.7);
      }
    }
  });

  it("the widened artery leads to the REAL exit", () => {
    // widenMainArtery and decorateMaze used to derive start/stairs
    // independently. If they ever disagree the floor gets a launch highway to
    // somewhere that isn't the exit, which is invisible in a screenshot.
    for (const runSeed of RUN_SEEDS) {
      for (const level of [1, 5, 9, 14, 22]) {
        const { grid, plan, endpoints } = buildFloor(level, runSeed);
        expect(endpoints, `L${level}: no endpoints`).not.toBeNull();
        expect(plan.start).toEqual(endpoints!.start);
        expect(plan.stairs).toEqual(endpoints!.stairs);
      }
    }
  });

  it("descending actually changes the floor's shape, not just its palette", () => {
    // The gap this whole wave exists to close: consecutive floors used to be
    // the same object re-tinted. Openness is a cheap proxy for macro shape.
    //
    // Compared at levels 21-25 ON PURPOSE: every one of them clamps to the same
    // 33×25 grid and the same braid cap, so grid SIZE is held constant and the
    // only thing varying is the archetype (they cover all five). Comparing
    // levels 1-5 instead would measure the size curve, not the shape.
    const openness = (level: number, runSeed: number): number => {
      const { grid } = buildFloor(level, runSeed);
      let floors = 0;
      for (let k = 0; k < grid.t.length; k++) if (grid.t[k] === T_FLOOR) floors++;
      return floors / grid.t.length;
    };
    const runSeeds = [20260720, 31337, 8675309];
    const perLevel = [21, 22, 23, 24, 25].map((l) => runSeeds.reduce((s, rs) => s + openness(l, rs), 0) / runSeeds.length);
    // Sanity: the size really is held constant across these depths.
    const widths = new Set([21, 22, 23, 24, 25].map((l) => buildFloor(l, 1).grid.w));
    expect(widths.size, "levels 21-25 should share a grid width").toBe(1);
    // The five archetypes should span a genuinely different amount of open floor.
    expect(Math.max(...perLevel) - Math.min(...perLevel)).toBeGreaterThan(0.05);
  });
});
