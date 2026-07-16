import { describe, it, expect } from "vitest";
import { generateMaze, thickenWalls, carveRooms, crackSecretWalls, mulberry32, at, T_FLOOR, T_STAIRS, T_WALL, T_CRACKED, idx } from "./generator";
import { decorateMaze } from "./decorate";
import { bfsDistances } from "../entities/ai";

function makeLevel(seed: number, zombies = 8, torches = 10, parts = 10) {
  const g = generateMaze(10, 8, mulberry32(seed));
  // Snapshot distances BEFORE decorate stamps the stairs tile.
  const dist = bfsDistances(g, 1, 1);
  const plan = decorateMaze(g, mulberry32(seed + 1), zombies, torches, parts);
  return { g, dist, plan };
}

/** Walkable cardinal neighbours of a tile (for part-topology assertions). */
function openSides(g: ReturnType<typeof generateMaze>, i: number, j: number): Array<[number, number]> {
  return ([[0, -1], [1, 0], [0, 1], [-1, 0]] as Array<[number, number]>).filter(([di, dj]) => at(g, i + di, j + dj) === T_FLOOR);
}

describe("decorateMaze", () => {
  it("puts the stairs at the maximum BFS distance from the start", () => {
    const { g, dist, plan } = makeLevel(11);
    const max = Math.max(...Array.from(dist));
    expect(dist[idx(g, plan.stairs.i, plan.stairs.j)]).toBe(max);
    expect(at(g, plan.stairs.i, plan.stairs.j)).toBe(T_STAIRS);
  });

  it("places the requested number of spawns, none near the start", () => {
    const { g, dist, plan } = makeLevel(23);
    expect(plan.spawns.length).toBe(8);
    for (const s of plan.spawns) {
      expect(at(g, s.i, s.j)).toBe(T_FLOOR);
      expect(dist[idx(g, s.i, s.j)]).toBeGreaterThanOrEqual(5);
    }
  });

  it("mounts every torch on a real wall", () => {
    const { g, plan } = makeLevel(37);
    expect(plan.torches.length).toBeGreaterThan(0);
    for (const t of plan.torches) {
      expect(at(g, t.i, t.j)).toBe(T_FLOOR);
      expect(at(g, t.i + t.di, t.j + t.dj)).toBe(T_WALL);
    }
  });

  it("keeps the start tile a plain floor", () => {
    const { g, plan } = makeLevel(53);
    expect(plan.start).toEqual({ i: 1, j: 1 });
    expect(at(g, 1, 1)).toBe(T_FLOOR);
  });

  it("scatters this level's roll — three distinct weapons + all gear — on clear floor", () => {
    const { g, dist, plan } = makeLevel(71);

    const gear = plan.items.filter((it) => it.kind === "gear").map((it) => it.id);
    expect(gear.sort()).toEqual(["armor", "boots", "helmet"]);

    const weapons = plan.items.filter((it) => it.kind === "weapon").map((it) => it.id);
    expect(weapons.length).toBe(3);
    expect(new Set(weapons).size).toBe(3); // no duplicates in one level's roll
    const pool = ["stick", "mace", "chair", "gun", "bow", "flamethrower"];
    for (const id of weapons) expect(pool).toContain(id);

    for (const it of plan.items) {
      expect(at(g, it.i, it.j)).toBe(T_FLOOR);
      expect(dist[idx(g, it.i, it.j)]).toBeGreaterThanOrEqual(4);
      expect(plan.spawns.some((s) => s.i === it.i && s.j === it.j)).toBe(false);
      expect(it.i === plan.stairs.i && it.j === plan.stairs.j).toBe(false);
    }
    // Spread out — no two pickups share a corridor cluster.
    for (const a of plan.items) {
      for (const b of plan.items) {
        if (a === b) continue;
        expect(Math.abs(a.i - b.i) + Math.abs(a.j - b.j)).toBeGreaterThanOrEqual(5);
      }
    }
  });

  it("places pinball parts whose kind MATCHES the tile's topology", () => {
    const { g, plan } = makeLevel(97);
    expect(plan.parts.length).toBeGreaterThan(0);
    for (const part of plan.parts) {
      const open = openSides(g, part.i, part.j);
      if (part.kind === "spring" || part.kind === "trapdoor") {
        // dead end — one way out, and the launcher aims along it
        expect(open.length).toBe(1);
        expect([part.dirI, part.dirJ]).toEqual([open[0][0], open[0][1]]);
      } else if (part.kind === "ramp" || part.kind === "oil" || part.kind === "slingshot") {
        // straight corridor — two OPPOSITE open sides, lane parts along it
        // (sum-to-zero sidesteps the -0 !== +0 Object.is quirk)
        expect(open.length).toBe(2);
        expect(open[0][0] + open[1][0]).toBe(0);
        expect(open[0][1] + open[1][1]).toBe(0);
        if (part.kind !== "oil") expect(open.some(([di, dj]) => di === part.dirI && dj === part.dirJ)).toBe(true);
      } else if (part.kind === "glove") {
        // straight corridor — the glove punches ACROSS the lane, off a wall
        expect(open.length).toBe(2);
        expect(open[0][0] + open[1][0]).toBe(0);
        expect(open[0][1] + open[1][1]).toBe(0);
        // dir ⊥ corridor axis, and the mount side (-dir) is a solid wall
        expect(open.some(([di, dj]) => di === part.dirI && dj === part.dirJ)).toBe(false);
        expect(at(g, part.i - part.dirI, part.j - part.dirJ)).not.toBe(T_FLOOR);
      } else if (part.kind === "deflector") {
        // corner — two PERPENDICULAR open legs, both recorded on the part
        expect(open.length).toBe(2);
        expect(open[0][0] === -open[1][0] && open[0][1] === -open[1][1]).toBe(false);
        for (const [di, dj] of [[part.dirI, part.dirJ], [part.dir2I, part.dir2J]]) {
          expect(open.some(([oi, oj]) => oi === di && oj === dj)).toBe(true);
        }
      } else if (part.kind === "target") {
        // wall-mounted, like a torch: dir points at a solid wall
        expect(at(g, part.i + part.dirI, part.j + part.dirJ)).toBe(T_WALL);
      } else {
        // bumper / spinpad — a junction (3+ ways out): an open crossing
        expect(open.length).toBeGreaterThanOrEqual(3);
      }
    }
    // Spacing: DEALT parts never bunch into one intersection (targets and
    // trapdoors are separate layers with their own spacing rules).
    const dealt = plan.parts.filter((p) => p.kind !== "target" && p.kind !== "trapdoor");
    for (const a of dealt) {
      for (const b of dealt) {
        if (a === b) continue;
        expect(Math.abs(a.i - b.i) + Math.abs(a.j - b.j)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("respects the part budget and keeps parts off the stairs + away from the start", () => {
    const { g, plan } = makeLevel(113, 8, 10, 6);
    // Targets + trapdoors are objective/traversal layers OVER the budget; the
    // dealt machine parts themselves must stay inside it.
    const dealt = plan.parts.filter((p) => p.kind !== "target" && p.kind !== "trapdoor");
    expect(dealt.length).toBeLessThanOrEqual(6);
    const targets = plan.parts.filter((p) => p.kind === "target");
    expect(targets.length).toBeLessThanOrEqual(5);
    for (const part of dealt) {
      expect(at(g, part.i, part.j)).toBe(T_FLOOR); // never on the stairs tile
      expect(Math.abs(part.i - plan.start.i) + Math.abs(part.j - plan.start.j)).toBeGreaterThanOrEqual(4);
    }
  });

  it("dead-end economics: trapdoors sit on dead ends, the frog gets a perch when one is spare", () => {
    const { g, plan } = makeLevel(151, 8, 10, 12);
    for (const td of plan.parts.filter((p) => p.kind === "trapdoor")) {
      expect(openSides(g, td.i, td.j).length).toBe(1);
    }
    if (plan.frog) {
      expect(openSides(g, plan.frog.i, plan.frog.j).length).toBe(1);
      // never doubled onto a spring or trapdoor
      expect(plan.parts.some((p) => p.i === plan.frog!.i && p.j === plan.frog!.j)).toBe(false);
    }
  });
});

/** The full pipeline a real level runs: rooms + cracks on the raw grid, then thicken. */
function makeFullLevel(seed: number) {
  const raw = generateMaze(14, 11, mulberry32(seed));
  const rawRooms = carveRooms(raw, mulberry32(seed + 1), 3, 2, 4);
  crackSecretWalls(raw, mulberry32(seed + 2), 3);
  const g = thickenWalls(raw);
  const rooms = rawRooms.map((r) => ({ i0: r.i0 * 2, j0: r.j0 * 2, w: r.w * 2, h: r.h * 2 }));
  const plan = decorateMaze(g, mulberry32(seed + 3), 10, 12, 10, rooms);
  return { g, rooms, plan };
}

describe("decorateMaze — rooms + secrets", () => {
  it("deals every carved room an archetype and furnishes it", () => {
    const { rooms, plan } = makeFullLevel(7);
    expect(plan.rooms.length).toBe(rooms.length);
    for (const room of plan.rooms) {
      const inside = (p: { i: number; j: number }): boolean =>
        p.i >= room.i0 && p.i < room.i0 + room.w && p.j >= room.j0 && p.j < room.j0 + room.h;
      if (room.kind === "bumper") {
        const bumpers = plan.parts.filter((p) => p.kind === "bumper" && inside(p));
        expect(bumpers.length).toBeGreaterThanOrEqual(3);
      } else if (room.kind === "speedway") {
        const ramps = plan.parts.filter((p) => p.kind === "ramp" && inside(p));
        expect(ramps.length).toBeGreaterThanOrEqual(2);
        // every ramp in the lane is aimed the SAME way
        const dirs = new Set(ramps.map((r) => `${r.dirI},${r.dirJ}`));
        expect(dirs.size).toBe(1);
      } else if (room.kind === "arena") {
        expect(plan.spawns.filter(inside).length).toBeGreaterThanOrEqual(3);
        expect(plan.items.filter((it) => it.kind === "potion" && inside(it)).length).toBeGreaterThanOrEqual(1);
      } else {
        // vault: a weapon prize + guards
        expect(plan.items.filter((it) => it.kind === "weapon" && inside(it)).length).toBe(1);
        expect(plan.spawns.filter(inside).length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("collects every cracked band's top-left handle into plan.secrets", () => {
    const { g, plan } = makeFullLevel(41);
    expect(plan.secrets.length).toBeGreaterThan(0);
    for (const s of plan.secrets) {
      expect(s.i % 2).toBe(0);
      expect(s.j % 2).toBe(0);
      for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        expect(at(g, s.i + di, s.j + dj)).toBe(T_CRACKED);
      }
    }
    // Exactly the stamped bands, no double-counting.
    let crackedTiles = 0;
    for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) if (at(g, i, j) === T_CRACKED) crackedTiles++;
    expect(plan.secrets.length * 4).toBe(crackedTiles);
  });

  it("never mounts a torch on a cracked band (the sconce would float after the smash)", () => {
    const { g, plan } = makeFullLevel(97);
    for (const t of plan.torches) {
      expect(at(g, t.i + t.di, t.j + t.dj)).toBe(T_WALL);
    }
  });
});
