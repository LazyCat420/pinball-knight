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
        // straight corridor — the glove punches ACROSS the lane, off a side wall
        expect(open.length).toBe(2);
        expect(open[0][0] + open[1][0]).toBe(0);
        expect(open[0][1] + open[1][1]).toBe(0);
        expect(open.some(([di, dj]) => di === part.dirI && dj === part.dirJ)).toBe(false);
        expect(at(g, part.i - part.dirI, part.j - part.dirJ)).not.toBe(T_FLOOR);
      } else if (part.kind === "firevent") {
        // wall-mounted (like a torch): the mount side (-dir) is a solid wall,
        // and it jets INTO an open floor tile along dir.
        expect(at(g, part.i - part.dirI, part.j - part.dirJ)).toBe(T_WALL);
        expect(at(g, part.i + part.dirI, part.j + part.dirJ)).toBe(T_FLOOR);
      } else if (part.kind === "deflector") {
        // corner — two PERPENDICULAR open legs, both recorded on the part
        expect(open.length).toBe(2);
        expect(open[0][0] === -open[1][0] && open[0][1] === -open[1][1]).toBe(false);
        for (const [di, dj] of [[part.dirI, part.dirJ], [part.dir2I, part.dir2J]]) {
          expect(open.some(([oi, oj]) => oi === di && oj === dj)).toBe(true);
        }
      } else if (part.kind === "mirror") {
        // corner — the surface line is the corner diagonal (both open legs sum)
        expect(open.length).toBe(2);
        expect(Math.abs(part.dirI)).toBe(1);
        expect(Math.abs(part.dirJ)).toBe(1);
      } else if (part.kind === "target") {
        // wall-mounted, like a torch: dir points at a solid wall
        expect(at(g, part.i + part.dirI, part.j + part.dirJ)).toBe(T_WALL);
      } else if (part.kind === "flipper") {
        // junction paddle: 3+ open ways, aimed down one open leg
        expect(open.length).toBeGreaterThanOrEqual(3);
        expect(open.some(([di, dj]) => di === part.dirI && dj === part.dirJ)).toBe(true);
      } else if (part.kind === "pit" || part.kind === "electric" || part.kind === "magstrip") {
        // floor hazards: sit on any open floor (junction OR straight)
        expect(open.length).toBeGreaterThanOrEqual(2);
      } else {
        // bumper / spinpad — a junction (3+ ways out): an open crossing
        expect(open.length).toBeGreaterThanOrEqual(3);
      }
    }
    // Spacing: DEALT machine parts never bunch into one intersection. Targets,
    // trapdoors and floor hazards are separate layers with their own rules.
    const layerKinds = new Set(["target", "trapdoor", "pit", "electric", "firevent", "magstrip"]);
    const dealt = plan.parts.filter((p) => !layerKinds.has(p.kind));
    for (const a of dealt) {
      for (const b of dealt) {
        if (a === b) continue;
        expect(Math.abs(a.i - b.i) + Math.abs(a.j - b.j)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("no straight-corridor launch part is left firing into a wall (Slice 3 no-orphan)", () => {
    const { g, plan } = makeLevel(129);
    const runway = (i: number, j: number, di: number, dj: number): number => {
      let n = 0;
      for (let s = 1; s <= 8; s++) {
        if (at(g, i + di * s, j + dj * s) !== T_FLOOR) break;
        n++;
      }
      return n;
    };
    for (const p of plan.parts) {
      if (p.kind !== "ramp" && p.kind !== "slingshot") continue;
      const open = openSides(g, p.i, p.j);
      // only true straight corridors (2 OPPOSITE open sides) — the dealt launch parts
      if (open.length !== 2 || open[0][0] + open[1][0] !== 0 || open[0][1] + open[1][1] !== 0) continue;
      expect(runway(p.i, p.j, p.dirI, p.dirJ), `${p.kind}@${p.i},${p.j} launches into a wall`).toBeGreaterThanOrEqual(3);
    }
  });

  it("respects the part budget and keeps parts off the stairs + away from the start", () => {
    const { g, plan } = makeLevel(113, 8, 10, 6);
    // Targets, trapdoors + hazards are objective/traversal layers OVER the
    // budget; the dealt machine parts themselves must stay inside it.
    const layerKinds = new Set(["target", "trapdoor", "pit", "electric", "firevent", "magstrip"]);
    const dealt = plan.parts.filter((p) => !layerKinds.has(p.kind));
    expect(dealt.length).toBeLessThanOrEqual(6);
    // Scattered break-them-all targets stay within budget; the Slice 6 drop-target
    // BANK is a separate layer (bank !== undefined) and doesn't count against it.
    const targets = plan.parts.filter((p) => p.kind === "target" && p.bank === undefined);
    expect(targets.length).toBeLessThanOrEqual(5);
    const hazards = plan.parts.filter((p) => p.kind === "pit" || p.kind === "electric" || p.kind === "firevent" || p.kind === "magstrip");
    expect(hazards.length).toBeLessThanOrEqual(4);
    for (const part of dealt) {
      expect(at(g, part.i, part.j)).toBe(T_FLOOR); // never on the stairs tile
      expect(Math.abs(part.i - plan.start.i) + Math.abs(part.j - plan.start.j)).toBeGreaterThanOrEqual(4);
    }
  });

  it("a target BANK (when placed) is 3 in-a-row, seq 0-1-2, all facing a wall (Slice 6)", () => {
    // best-effort placement — scan seeds until one floor hosts a bank
    let bank: ReturnType<typeof makeLevel>["plan"]["parts"] = [];
    let g!: ReturnType<typeof makeLevel>["g"];
    for (let seed = 200; seed < 240 && bank.length === 0; seed++) {
      const lvl = makeLevel(seed);
      const b = lvl.plan.parts.filter((p) => p.kind === "target" && p.bank !== undefined);
      if (b.length) { bank = b; g = lvl.g; }
    }
    if (bank.length === 0) return; // no bank in the sampled seeds — acceptable
    expect(bank.length).toBe(3);
    expect(new Set(bank.map((p) => p.seq)).size).toBe(3); // distinct 0,1,2
    for (const t of bank) expect(at(g, t.i + t.dirI, t.j + t.dirJ)).toBe(T_WALL); // faces a wall
    // collinear + adjacent (a real "row")
    const sorted = [...bank].sort((a, b2) => (a.seq ?? 0) - (b2.seq ?? 0));
    for (let k = 1; k < sorted.length; k++) {
      expect(Math.abs(sorted[k].i - sorted[k - 1].i) + Math.abs(sorted[k].j - sorted[k - 1].j)).toBe(1);
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

  it("zones rooms by distance: near start = speedway (launch), far = arena/vault (drain) — Slice 9", () => {
    // scan seeds for a floor with clearly-separated rooms (a near + a far one)
    for (let seed = 300; seed < 340; seed++) {
      const { plan } = makeFullLevel(seed);
      if (plan.rooms.length < 2) continue;
      const dist = (r: { i0: number; j0: number; w: number; h: number }): number =>
        Math.abs(r.i0 + Math.floor(r.w / 2) - plan.start.i) + Math.abs(r.j0 + Math.floor(r.h / 2) - plan.start.j);
      const sorted = [...plan.rooms].sort((a, b) => dist(a) - dist(b));
      const near = sorted[0];
      const far = sorted[sorted.length - 1];
      const maxD = dist(far);
      if (maxD < 10 || dist(near) / maxD > 0.33) continue; // need a real spread with a launch-zone room
      // near room in the launch zone → speedway; far room in the drain zone → arena/vault
      expect(near.kind).toBe("speedway");
      expect(["arena", "vault"]).toContain(far.kind);
      return;
    }
    // no suitably-spread floor sampled — acceptable, zoning is distance-driven
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

describe("decorateMaze — prefab anchors always get a firing direction", () => {
  // Prefab stamps (maze/prefabs.ts) drop their signature parts into OPEN rooms,
  // where a tile classifies as a junction with no axis. A directional part with
  // a zero axis fires nowhere — a spring that won't launch, a ramp that won't
  // dash. The anchor handler must aim any such part down an open neighbour.
  it("a directional anchor on an open (junction) tile never ends up with a zero axis", () => {
    const g = thickenWalls(generateMaze(12, 9, mulberry32(7), 0.3));

    // Collect a handful of junction floor tiles (3+ open neighbours), spaced so
    // each anchor lands on its own tile rather than being folded by the dedup.
    const junctions: Array<{ i: number; j: number }> = [];
    for (let j = 1; j < g.h - 1 && junctions.length < 5; j++) {
      for (let i = 1; i < g.w - 1 && junctions.length < 5; i++) {
        if (at(g, i, j) !== T_FLOOR) continue;
        const open = openSides(g, i, j).length;
        if (open >= 3 && junctions.every((q) => Math.abs(q.i - i) + Math.abs(q.j - j) >= 2)) junctions.push({ i, j });
      }
    }
    expect(junctions.length).toBeGreaterThan(0);

    const kinds = ["spring", "ramp", "glove", "slingshot", "trapdoor"] as const;
    const anchors = junctions.map((p, k) => ({ i: p.i, j: p.j, kind: kinds[k % kinds.length] }));
    // No corridor parts / torches — the only directional parts are our anchors.
    const plan = decorateMaze(g, mulberry32(8), 0, 0, 0, [], { anchors });

    const directional = new Set<string>(kinds);
    const placed = plan.parts.filter((p) => directional.has(p.kind));
    expect(placed.length).toBeGreaterThan(0);
    for (const p of placed) {
      expect(p.dirI !== 0 || p.dirJ !== 0, `${p.kind} @ ${p.i},${p.j} fires nowhere`).toBe(true);
    }
  });
});
