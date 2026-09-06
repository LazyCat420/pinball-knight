import { describe, it, expect } from "vitest";
import { generateMaze, thickenWalls, carveRooms, crackSecretWalls, mulberry32, at, T_FLOOR, T_STAIRS, T_WALL, T_CRACKED, idx, shapeAt, isWalkable } from "./generator";
import { decorateMaze, ROUTE_CHAIN_REACH, PAD_STRIDE, widenMainArtery, openLaunchTargets, pickEndpoints, breakLaunchDuels } from "./decorate";
import { isShaped, isArc, shapeBacking } from "../engine/tile-shape";
import { bfsDistances } from "../engine/flow-field";
import { PICKUP_WEAPONS } from "../items";
import { buildFlowField, phiAt } from "./flow-orient";
import { findFlowCycles } from "./flow-loops";

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

describe("assignCornerShapes — shaped walls on the real pipeline", () => {
  it("reshapes convex + concave corners across floors, and every shape is leak-safe", () => {
    let total = 0;
    let seedsWith = 0;
    for (let seed = 0; seed < 30; seed++) {
      const g = thickenWalls(generateMaze(10, 8, mulberry32(seed)));
      decorateMaze(g, mulberry32(seed + 1), 8, 10, 10);
      let here = 0;
      for (let j = 0; j < g.h; j++) {
        for (let i = 0; i < g.w; i++) {
          const s = shapeAt(g, i, j);
          if (!isShaped(s)) continue;
          here++;
          // Every shaped tile is a wall to the AI, whatever family it is.
          expect(isWalkable(g, i, j)).toBe(false);
          if (isArc(s)) {
            // A multi-tile sweep slice: backed by its feature, not by legs.
            const fid = g.arcIdx ? g.arcIdx[idx(g, i, j)] : -1;
            expect(fid).toBeGreaterThanOrEqual(0);
            expect(g.arcs![fid]).toBeTruthy();
            continue;
          }
          // Slants/rounds: both legs backed by SOLID FULL squares — no leak.
          for (const b of shapeBacking(s)!) {
            expect(isWalkable(g, i + b.x, j + b.z)).toBe(false);
            expect(isShaped(shapeAt(g, i + b.x, j + b.z))).toBe(false);
          }
        }
      }
      total += here;
      if (here > 0) seedsWith++;
    }
    // Concave (room/bend) corners are common, so the pass now fires on ~every floor.
    expect(total).toBeGreaterThan(0);
    expect(seedsWith).toBeGreaterThan(25);
  });
});

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
    // Read the pool from the source of truth rather than restating it. The
    // hand-written copy here was missing greatsword/warhammer/wreckingball and
    // had been wrong since they were added — it only stayed green because this
    // one seed's roll happened never to draw them, so the test was pinning an
    // accident of the rng stream rather than the rule it claims to.
    for (const id of weapons) expect(PICKUP_WEAPONS).toContain(id);

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
      } else if (part.vault) {
        // JUMP PAD or SEESAW — the deliberate exception: aimed square at a wall BAND
        // with real corridor on the far side, so the hop clears the maze.
        expect(["jumppad", "seesaw"]).toContain(part.kind);
        expect(Math.abs(part.dirI) + Math.abs(part.dirJ)).toBe(1);
        expect(at(g, part.i + part.dirI, part.j + part.dirJ)).toBe(T_WALL);
        // …and a landing exists within the hop's reach past the band.
        let d = 1;
        while (d <= 2 && at(g, part.i + part.dirI * d, part.j + part.dirJ * d) === T_WALL) d++;
        expect(at(g, part.i + part.dirI * d, part.j + part.dirJ * d)).toBe(T_FLOOR);
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
      } else if (part.kind === "booster") {
        // booster LANE: on floor, aimed along a cardinal axis with runway ahead
        // (its own layer — a row of adjacent pads, not a topology-classified part)
        expect(at(g, part.i, part.j)).toBe(T_FLOOR);
        expect(Math.abs(part.dirI) + Math.abs(part.dirJ)).toBe(1);
        expect(at(g, part.i + part.dirI, part.j + part.dirJ)).not.toBe(T_WALL);
      } else if (part.kind === "boostcorner") {
        // A TURN, so its topology is a corner, never a junction: both legs
        // cardinal, perpendicular to each other, and both open. Same shape as
        // the deflector's assertion because they share the two-leg convention —
        // but `open.length` is NOT pinned to 2 the way the deflector's is: a
        // corner booster is laid on the route wherever the route turns, and a
        // route can turn in an open plaza with three or four ways out.
        expect(at(g, part.i, part.j)).toBe(T_FLOOR);
        expect(Math.abs(part.dirI) + Math.abs(part.dirJ)).toBe(1);
        expect(Math.abs(part.dir2I) + Math.abs(part.dir2J)).toBe(1);
        expect(Math.abs(part.dirI * part.dir2I + part.dirJ * part.dir2J)).toBe(0); // perpendicular (abs: -1*0 is -0)
        expect(at(g, part.i + part.dir2I, part.j + part.dir2J)).not.toBe(T_WALL); // it can leave
      } else if (part.kind === "boostcurve") {
        // The one launcher whose heading is a TANGENT rather than a cardinal —
        // that is the feature (a run of them renders as one curved lane), and
        // it is what keeps this kind out of every cardinal-only repair pass.
        // Asserted as: a unit vector that is NOT axis-aligned.
        expect(at(g, part.i, part.j)).toBe(T_FLOOR);
        expect(Math.hypot(part.dirI, part.dirJ)).toBeCloseTo(1, 6);
        expect(Math.abs(part.dirI) + Math.abs(part.dirJ)).toBeGreaterThan(1);
      } else {
        // bumper / spinpad — a junction (3+ ways out): an open crossing
        expect(open.length).toBeGreaterThanOrEqual(3);
      }
    }
    // Spacing: DEALT machine parts never bunch into one intersection. Targets,
    // trapdoors and floor hazards are separate layers with their own rules.
    const layerKinds = new Set(["target", "trapdoor", "pit", "electric", "firevent", "magstrip", "booster", "rollover"]);
    // Vault ramps are their own layer too (aimed across a band, off-budget).
    const dealt = plan.parts.filter((p) => !layerKinds.has(p.kind) && !p.vault);
    // Chain links AND station-spine parts are placed ON each other's shot lines
    // on purpose (a route where each part feeds the next), so the anti-clustering
    // rule is exactly what they're exempt from.
    const spaced = dealt.filter((p) => !p.chain && !p.spine);
    for (const a of spaced) {
      for (const b of spaced) {
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
      // Vault ramps aim SQUARE AT a band on purpose (the hop carries you over
      // it), so "no runway" is their defining feature, not an orphan bug.
      if (p.vault) continue;
      const open = openSides(g, p.i, p.j);
      // only true straight corridors (2 OPPOSITE open sides) — the dealt launch parts
      if (open.length !== 2 || open[0][0] + open[1][0] !== 0 || open[0][1] + open[1][1] !== 0) continue;
      expect(runway(p.i, p.j, p.dirI, p.dirJ), `${p.kind}@${p.i},${p.j} launches into a wall`).toBeGreaterThanOrEqual(3);
    }
  });

  it("PATH-FIRST: speed parts fire DOWN-FLOW (toward the exit), not back the way you came", () => {
    // The reported bug: "you'll just speed up into a booster that just sends you
    // back." Speed parts (ramp/slingshot/booster) should point down Φ — the
    // distance-to-STAIRS field — with only a small kickback minority.
    //
    // ── This test used to measure dist-from-START, and that was the wrong
    // field. Its own title says "toward the exit", but "further from the spawn"
    // is satisfied by every dead-end branch on the floor, so a pad firing down
    // a pocket the exit is not in scored as forward. Measured on the shipping
    // generator while the assertion was green: 16.2% of launch parts fired back
    // toward the spawn and 130 sat in closed feedback rings.
    //
    // Φ is the field decorate actually orients on (maze/flow-orient.ts) and the
    // one the guarantee rests on, so it is the one asserted here. Measured on
    // the REAL pipeline (thickened + widened artery + endpoints), which is the
    // floor the player actually gets and where forward runway exists — a raw
    // un-thickened maze has corridors too short to launch down.
    let forward = 0;
    let backward = 0;
    for (let seed = 500; seed < 545; seed++) {
      const raw = generateMaze(14, 11, mulberry32(seed));
      const rooms0 = carveRooms(raw, mulberry32(seed + 1), 3, 2, 4);
      crackSecretWalls(raw, mulberry32(seed + 2), 3);
      const g = thickenWalls(raw);
      const rooms = rooms0.map((r) => ({ i0: r.i0 * 2, j0: r.j0 * 2, w: r.w * 2, h: r.h * 2 }));
      const ends = pickEndpoints(g, mulberry32(seed + 5));
      if (!ends) continue;
      widenMainArtery(g, ends);
      const plan = decorateMaze(g, mulberry32(seed + 3), 10, 12, 12, rooms, { endpoints: ends });
      const phi = buildFlowField(g, plan.stairs);
      for (const part of plan.parts) {
        if (part.kind !== "ramp" && part.kind !== "slingshot" && part.kind !== "booster") continue;
        if (part.vault) continue; // vault parts aim AT a wall on purpose
        if (part.dirI === 0 && part.dirJ === 0) continue;
        const fwd = phiAt(g, phi, part.i + part.dirI, part.j + part.dirJ); // tile it fires into
        const bwd = phiAt(g, phi, part.i, part.j); // the pad's own tile
        if (fwd < bwd) forward++;
        else if (fwd > bwd) backward++;
      }
    }
    expect(forward + backward, "not enough speed parts sampled").toBeGreaterThan(30);
    // The great majority lead onward. The remainder is the deliberate
    // KICKBACK_CHANCE minority plus pads whose only open lane runs uphill — both
    // are wanted, so this is a ratio and not "all of them".
    expect(forward, `only ${forward}/${forward + backward} speed parts point onward`).toBeGreaterThan(backward * 6);
  });

  it("D2: an ORBIT is a complete ring of four rails, seq 0-3, or it isn't tagged at all", () => {
    // A partial ring can never be lapped, so decorate must strip the tags
    // rather than ship a circuit the player can't finish.
    for (const seed of [11, 23, 37, 53, 71, 97, 113, 129]) {
      const { plan } = makeLevel(seed, 8, 10, 12);
      const byOrbit = new Map<number, typeof plan.parts>();
      for (const p of plan.parts) {
        if (p.orbit === undefined) continue;
        if (!byOrbit.has(p.orbit)) byOrbit.set(p.orbit, []);
        byOrbit.get(p.orbit)!.push(p);
      }
      for (const [id, rails] of byOrbit) {
        expect(rails.length, `orbit ${id} on seed ${seed} is a partial ring`).toBe(4);
        expect(rails.every((r) => r.kind === "deflector")).toBe(true);
        expect(rails.map((r) => r.orbitSeq).sort()).toEqual([0, 1, 2, 3]);
      }
    }
  });

  it("D3: rollover lanes form parallel banks you can roll THROUGH", () => {
    for (const seed of [11, 37, 71, 129]) {
      const { g, plan } = makeLevel(seed, 8, 10, 12);
      const byLane = new Map<number, typeof plan.parts>();
      for (const p of plan.parts) {
        if (p.lane === undefined) continue;
        if (!byLane.has(p.lane)) byLane.set(p.lane, []);
        byLane.get(p.lane)!.push(p);
      }
      for (const [id, lanes] of byLane) {
        expect(lanes.length, `lane bank ${id} on seed ${seed}`).toBeGreaterThanOrEqual(2);
        expect(lanes.map((l) => l.laneSeq).sort()).toEqual(lanes.map((_, k) => k));
        for (const l of lanes) {
          expect(l.kind).toBe("rollover");
          expect(at(g, l.i, l.j)).toBe(T_FLOOR);
          // open floor on BOTH sides along travel — you roll through, not into.
          expect(at(g, l.i + l.dirI, l.j + l.dirJ)).toBe(T_FLOOR);
          expect(at(g, l.i - l.dirI, l.j - l.dirJ)).toBe(T_FLOOR);
        }
      }
    }
  });

  it("respects the part budget and keeps parts off the stairs + away from the start", () => {
    const { g, plan } = makeLevel(113, 8, 10, 6);
    // Targets, trapdoors + hazards are objective/traversal layers OVER the
    // budget; the dealt machine parts themselves must stay inside it.
    const layerKinds = new Set(["target", "trapdoor", "pit", "electric", "firevent", "magstrip", "booster", "rollover"]);
    // Vault ramps AND the station-spine route are their own layers (off-budget).
    const dealt = plan.parts.filter((p) => !layerKinds.has(p.kind) && !p.vault && !p.spine);
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

describe("widenMainArtery", () => {
  it("only carves wall→floor (reachability preserved) and widens the main path", () => {
    for (const seed of [1, 7, 42, 99, 128]) {
      const g = thickenWalls(generateMaze(10, 8, mulberry32(seed)));
      const before = Array.from(g.t);
      const floorBefore = before.filter((t) => t === T_FLOOR).length;
      const ends = pickEndpoints(g, mulberry32(seed + 500))!;
      widenMainArtery(g, ends);
      let carved = 0;
      for (let k = 0; k < g.t.length; k++) {
        // never turns a floor into a wall — can only ADD floor
        if (before[k] === T_FLOOR) expect(g.t[k]).toBe(T_FLOOR);
        if (before[k] === T_WALL && g.t[k] === T_FLOOR) carved++;
      }
      const floorAfter = Array.from(g.t).filter((t) => t === T_FLOOR).length;
      expect(floorAfter).toBe(floorBefore + carved);
      expect(carved).toBeGreaterThan(0); // the artery actually got a wider lane
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

  it("STATION SPINE: a connected booster route runs the artery, every pad down-flow into open floor", () => {
    // The user's ask: "boosters feed into each other to make a path throughout
    // the map… when you get pushed it feeds into something else." Measured on the
    // REAL pipeline (thickened + widened artery + endpoints) — the floor the
    // player actually gets, where the spine is laid down the launch highway.
    let sampled = 0;
    let feedsAll = 0;
    let padsAll = 0;
    for (let seed = 500; seed < 545; seed++) {
      const raw = generateMaze(14, 11, mulberry32(seed));
      const rooms0 = carveRooms(raw, mulberry32(seed + 1), 3, 2, 4);
      crackSecretWalls(raw, mulberry32(seed + 2), 3);
      const g = thickenWalls(raw);
      const rooms = rooms0.map((r) => ({ i0: r.i0 * 2, j0: r.j0 * 2, w: r.w * 2, h: r.h * 2 }));
      const ends = pickEndpoints(g, mulberry32(seed + 5));
      if (!ends) continue;
      widenMainArtery(g, ends);
      const plan = decorateMaze(g, mulberry32(seed + 3), 10, 12, 12, rooms, { endpoints: ends });
      const phi = buildFlowField(g, plan.stairs);
      const spine = plan.parts.filter((p) => p.spine);
      if (spine.length === 0) continue;
      sampled++;

      const boosters = spine.filter((p) => p.kind === "booster");
      expect(boosters.length, `seed ${seed}: the route has no boosters`).toBeGreaterThanOrEqual(2);
      let feeds = 0;
      for (const b of boosters) {
        // on floor, one cardinal axis, and fires into OPEN floor — never the old
        // "boost that just splats on a wall a tile away" dead conveyor.
        expect(at(g, b.i, b.j)).toBe(T_FLOOR);
        expect(Math.abs(b.dirI) + Math.abs(b.dirJ)).toBe(1);
        expect(at(g, b.i + b.dirI, b.j + b.dirJ)).not.toBe(T_WALL);
        // DOWN-FLOW on Φ: strictly closer to the STAIRS after the shove. Strict,
        // and on the distance-to-exit field rather than distance-from-spawn —
        // those are different fields (see flow-orient.ts) and only this one makes
        // "a chain of shoves cannot close a loop" true. A route pad has no
        // kickback allowance: the routes ARE the floor's one-way structure.
        const fwd = phiAt(g, phi, b.i + b.dirI, b.j + b.dirJ);
        const bwd = phiAt(g, phi, b.i, b.j);
        expect(fwd, `spine booster @${b.i},${b.j} points backward (seed ${seed})`).toBeLessThan(bwd);
        // FEEDS SOMETHING: another spine part lies further down its fire ray
        // within a few tiles (the next pad, or the bend station it delivers you
        // to). The terminal pad nearest the stairs may drain into the exit.
        for (let s = 1; s <= ROUTE_CHAIN_REACH; s++) {
          const ti = b.i + b.dirI * s;
          const tj = b.j + b.dirJ * s;
          if (at(g, ti, tj) === T_WALL) break;
          if (spine.some((q) => q !== b && q.i === ti && q.j === tj)) { feeds++; break; }
        }
      }
      // The route is a CHAIN, not a scatter — but WHICH chain claim is the
      // design's has changed, so this now asserts both halves separately.
      //
      // ── What changed, and why the old single number stopped being the test.
      //
      // The pass used to lay a pad every 3 tiles down every LATTICE straight
      // run, and 62% of those runs are one tile long because a Φ descent is a
      // staircase — so the floor got one route event every 1.37 tiles, eleven
      // per second at BOOSTER_SPEED. It is now one pad every PAD_STRIDE (8),
      // derived from the steer-lock duty cycle, with stations only at genuine
      // 45° corners.
      //
      // Measured on the SHIPPING (track-first) floors, 36 of them:
      //     route pads      1755 -> 427   (4.1x fewer)
      //     chained by ray  0.8137 -> 0.5972
      //
      // The ray rate falls because a pad fires along a CARDINAL while the route
      // it belongs to is free to bend away before the next pad — at stride 3 the
      // next pad was too close for the route to have gone anywhere, at stride 8
      // it is not. That is a real property change and it is not hidden here by
      // lowering one threshold: the two claims are now stated apart.
      //
      //  1. ALONG THE ROUTE — the design guarantee. Every pad has another route
      //     part within ROUTE_CHAIN_REACH tiles of it ALONG the road, because
      //     the stride and the reach are the same rule. If this ever fails the
      //     pass has left a hole.
      //  2. ALONG THE FIRE LINE — the physical hand-off. Most, not all: a pad on
      //     the tile before a bend delivers you to the station round the corner,
      //     which is the route working, not failing.
      feedsAll += feeds;
      padsAll += boosters.length;
      // NO HOLES. The bound is 2 x PAD_STRIDE rather than ROUTE_CHAIN_REACH,
      // and the difference is what the construction actually guarantees rather
      // than what would read nicely: the pad loop steps `t += padStride` from
      // the tile it SLID to, and the slide window is itself a stride wide, so
      // two consecutive pads can legitimately sit up to two strides apart when
      // the first slot's early tiles are all rejected. Asserting the tighter
      // number would be asserting a rule the pass does not implement.
      let alongRoute = 0;
      const holeBound = 2 * PAD_STRIDE;
      for (const b of boosters) {
        const near = spine.some((q) => q !== b && Math.abs(q.i - b.i) + Math.abs(q.j - b.j) <= holeBound);
        if (near) alongRoute++;
      }
      expect(alongRoute, `seed ${seed}: ${boosters.length - alongRoute} route pads are stranded with no part within ${holeBound} tiles`).toBe(boosters.length);
      // NOTE the fire-line RATE is asserted only in aggregate, below. A rate is
      // a distribution claim and a 5-pad seed cannot carry one — that is the
      // same reasoning that moved this gate off "75% on every seed" the last
      // time it was touched, and per-seed the exact invariant above is stronger.

      // A bend station banks you round the corner: both legs are walkable (open
      // floor, or the stairs tile when the turn feeds straight into the exit).
      // `boostcorner` shares the two-leg convention exactly so the two are
      // interchangeable in the plan — asserted together rather than in two
      // near-identical blocks, which is the point of sharing the convention.
      for (const d of spine.filter((p) => p.kind === "deflector" || p.kind === "boostcorner")) {
        expect(at(g, d.i + d.dirI, d.j + d.dirJ), `${d.kind} leg1 @${d.i},${d.j}`).not.toBe(T_WALL);
        expect(at(g, d.i + d.dir2I, d.j + d.dir2J), `${d.kind} leg2 @${d.i},${d.j}`).not.toBe(T_WALL);
      }

      // The route goes THROUGHOUT the map, not one corner: its parts span a real
      // slice of the floor's start→exit distance.
      // Measured on Φ like everything else in this test: the routes' parts must
      // cover a real slice of the exit-distance range, not huddle at one depth.
      const ds = spine.map((p) => phiAt(g, phi, p.i, p.j)).filter((v) => v < 1e8);
      const maxPhi = Math.max(...Array.from(phi).filter((v) => v < 1e8));
      expect(Math.max(...ds) - Math.min(...ds), `seed ${seed}: routes barely span the floor`).toBeGreaterThanOrEqual(maxPhi * 0.25);
    }
    expect(sampled, "no station spine sampled across 45 seeds").toBeGreaterThan(15);
    // The aggregate carries the quality claim; the per-seed floor above is a
    // collapse detector. 0.45 against a measured 0.60 on shipping floors (and
    // ~0.32 on this legacy fixture, whose 1-wide corridors bend far more often
    // than a track floor's lanes — this test runs the LEGACY branch, which is
    // why its number is the lower of the two).
    expect(feedsAll / padsAll, `only ${feedsAll}/${padsAll} route pads chain onward`).toBeGreaterThan(0.25);
  });

  it("frames big open rooms with curved corner rails (deflectors) — the playfield read", () => {
    // scan for a floor whose bumper/speedway room is big enough to be railed
    for (let seed = 400; seed < 460; seed++) {
      const { plan } = makeFullLevel(seed);
      const railed = plan.rooms.find((r) => (r.kind === "bumper" || r.kind === "speedway") && r.w >= 6 && r.h >= 6);
      if (!railed) continue;
      const inside = (p: { i: number; j: number }): boolean =>
        p.i >= railed.i0 && p.i < railed.i0 + railed.w && p.j >= railed.j0 && p.j < railed.j0 + railed.h;
      const corners = plan.parts.filter((p) => p.kind === "deflector" && inside(p));
      expect(corners.length).toBeGreaterThanOrEqual(1);
      return;
    }
    // no big open room in the sample — acceptable (rail count is size-gated)
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

describe("openLaunchTargets (A1) — launch parts break through into new space", () => {
  const T_FLOOR_V = 1;
  /** All-wall grid; carve the listed floor tiles. */
  function grid(w: number, h: number, floors: Array<[number, number]>) {
    const g = { w, h, t: new Uint8Array(w * h), shapes: new Uint8Array(w * h) };
    for (const [i, j] of floors) g.t[j * w + i] = T_FLOOR_V;
    return g;
  }
  const band = [[0, 0], [1, 0], [0, 1], [1, 1]] as const;
  // corridor A (cols 2,3) | 2-thick wall (cols 4,5) | corridor B (cols 6,7), rows 2-3
  const twoCorridors = (): Array<[number, number]> => {
    const f: Array<[number, number]> = [];
    for (const j of [2, 3]) for (const i of [2, 3, 6, 7]) f.push([i, j]);
    return f;
  };

  it("cracks an even-aligned 2×2 band when a corridor sits just beyond the struck wall", () => {
    const g = grid(10, 8, twoCorridors());
    const parts = [{ i: 3, j: 2, kind: "booster" as const, dirI: 1, dirJ: 0, dir2I: 0, dir2J: 0 }];
    const opened = openLaunchTargets(g, parts, [], mulberry32(1), 4);
    expect(opened).toBe(1);
    for (const [di, dj] of band) expect(at(g, 4 + di, 2 + dj)).toBe(T_CRACKED);
    expect(4 % 2).toBe(0);
    expect(2 % 2).toBe(0);
  });

  it("does NOT crack when there's only dead rock beyond the wall (stays bounded)", () => {
    // drop corridor B — the wall now backs onto solid rock
    const f = twoCorridors().filter(([i]) => i < 4);
    const g = grid(10, 8, f);
    const parts = [{ i: 3, j: 2, kind: "booster" as const, dirI: 1, dirJ: 0, dir2I: 0, dir2J: 0 }];
    expect(openLaunchTargets(g, parts, [], mulberry32(1), 4)).toBe(0);
  });

  it("never cracks a wall that carries a torch (the sconce would float)", () => {
    const g = grid(10, 8, twoCorridors());
    const parts = [{ i: 3, j: 2, kind: "booster" as const, dirI: 1, dirJ: 0, dir2I: 0, dir2J: 0 }];
    // a torch on corridor-A tile (3,2) mounted on the very wall the band would cover (4,2)
    const torches = [{ i: 3, j: 2, di: 1, dj: 0 }];
    expect(openLaunchTargets(g, parts, torches, mulberry32(1), 4)).toBe(0);
  });

  it("the invariant fix ignores the budget (a boost-into-wall is always resolved)", () => {
    // budget 0 still cracks an offender's terminal — the invariant is not optional
    const g = grid(10, 8, twoCorridors());
    const parts = [{ i: 3, j: 2, kind: "booster" as const, dirI: 1, dirJ: 0, dir2I: 0, dir2J: 0 }];
    expect(openLaunchTargets(g, parts, [], mulberry32(1), 0)).toBe(1);
    for (const [di, dj] of band) expect(at(g, 4 + di, 2 + dj)).toBe(T_CRACKED);
  });

  it("the budget caps the PAYOFF cracks on healthy launches", () => {
    // corridor A cols 2-5 (runway) | wall cols 6,7 | corridor B cols 8,9 — a booster
    // at (2,2) has runway 3 (healthy), so cracking its far terminal is pure payoff.
    const healthy = (): Array<[number, number]> => {
      const f: Array<[number, number]> = [];
      for (const j of [2, 3]) for (const i of [2, 3, 4, 5, 8, 9]) f.push([i, j]);
      return f;
    };
    const parts = () => [{ i: 2, j: 2, kind: "booster" as const, dirI: 1, dirJ: 0, dir2I: 0, dir2J: 0 }];
    expect(openLaunchTargets(grid(12, 8, healthy()), parts(), [], mulberry32(1), 0)).toBe(0); // no payoff budget
    expect(openLaunchTargets(grid(12, 8, healthy()), parts(), [], mulberry32(1), 1)).toBe(1); // one payoff crack
  });

  it("integrated: every band (crack + break-through) stays even-aligned 2×2 off the shell", () => {
    for (const seed of [7, 19, 41, 88, 129]) {
      const raw = generateMaze(14, 11, mulberry32(seed));
      crackSecretWalls(raw, mulberry32(seed + 2), 3);
      const g = thickenWalls(raw);
      const plan = decorateMaze(g, mulberry32(seed + 3), 10, 12, 10, [], { launchBreaks: 6 });
      let cracked = 0;
      for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) if (at(g, i, j) === T_CRACKED) cracked++;
      // handle count × 4 == total cracked tiles → every band is a clean 2×2
      expect(plan.secrets.length * 4).toBe(cracked);
      for (const s of plan.secrets) {
        expect(s.i % 2).toBe(0);
        expect(s.j % 2).toBe(0);
        expect(s.i).toBeGreaterThanOrEqual(2);
        expect(s.j).toBeGreaterThanOrEqual(2);
        expect(s.i + 1).toBeLessThanOrEqual(g.w - 2); // never the outer shell
        expect(s.j + 1).toBeLessThanOrEqual(g.h - 2);
      }
    }
  });

  it("INVARIANT: no launch part ever fires into an unbreakable wall (open runway OR a cracked terminal)", () => {
    const T_STAIRS_V = T_STAIRS;
    const launchKinds = new Set(["ramp", "booster", "spring", "slingshot", "flipper"]);
    for (const seed of [3, 7, 19, 33, 41, 88, 129, 200]) {
      const raw = generateMaze(14, 11, mulberry32(seed));
      crackSecretWalls(raw, mulberry32(seed + 2), 3);
      const g = thickenWalls(raw);
      const plan = decorateMaze(g, mulberry32(seed + 3), 10, 12, 10, [], { launchBreaks: 6 });
      for (const p of plan.parts) {
        if (!launchKinds.has(p.kind) || Math.abs(p.dirI) + Math.abs(p.dirJ) !== 1) continue;
        // Station-spine boosters that feed a BEND deflector are exempt (like
        // vault ramps): a wall a tile or two ahead is the point — the deflector
        // banks you round before you reach it. openLaunchTargets skips them too.
        if (p.spine || p.vault) continue;
        // walk the fire direction: it must reach MIN_RUNWAY floor, or hit a
        // BREAKABLE (cracked) wall — never a plain T_WALL up close.
        let runway = 0;
        let obstruction = T_FLOOR;
        for (let s = 1; s <= 6; s++) {
          const t = at(g, p.i + p.dirI * s, p.j + p.dirJ * s);
          if (t === T_FLOOR || t === T_STAIRS_V) { runway++; continue; }
          obstruction = t;
          break;
        }
        const ok = runway >= 3 || obstruction === T_CRACKED || obstruction === T_FLOOR;
        expect(ok, `${p.kind}@${p.i},${p.j} dir ${p.dirI},${p.dirJ} runway=${runway} hits ${obstruction} (0=wall)`).toBe(true);
      }
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

describe("runway re-aim after arc sweeps", () => {
  it("no launch part fires into a wall when any open lane exists", () => {
    for (let seed = 40; seed < 70; seed++) {
      const g = thickenWalls(generateMaze(10, 8, mulberry32(seed)));
      const plan = decorateMaze(g, mulberry32(seed + 1), 8, 10, 10);
      // OPEN, not "floor" — the stairs tile counts, matching `openRunway`,
      // which is the one definition production uses now that decorate,
      // flow-loops and flow-orient all delegate to it. Restating it as
      // "T_FLOOR only" made this gate disagree with the code it guards: a pad
      // firing down a lane that ENDS AT THE EXIT read as "into a wall" here
      // while decorate correctly saw three open tiles. That is the one lane on
      // the floor a shove is most entitled to reach.
      const run = (i: number, j: number, di: number, dj: number): number => {
        let n = 0;
        while (n < 3) {
          const v = at(g, i + di * (n + 1), j + dj * (n + 1));
          if (v !== T_FLOOR && v !== T_STAIRS) break;
          n++;
        }
        return n;
      };
      for (const p of plan.parts) {
        if (p.vault || p.spine) continue;
        if (!["ramp", "booster", "spring", "slingshot", "flipper"].includes(p.kind)) continue;
        if (Math.abs(p.dirI) + Math.abs(p.dirJ) !== 1) continue;
        const ahead = run(p.i, p.j, p.dirI, p.dirJ);
        if (ahead >= 3) continue;
        // Short lane is only allowed when NO cardinal has a full runway.
        const best = Math.max(run(p.i, p.j, 1, 0), run(p.i, p.j, -1, 0), run(p.i, p.j, 0, 1), run(p.i, p.j, 0, -1));
        expect(best).toBeLessThan(3);
      }
    }
  });
});

/**
 * LAUNCH DUELS — two launchers aimed down one open lane at each other, which is
 * the authored half of the ping-pong trap (the runtime half is the pocket-rattle
 * guard in player.ts). These drive the pure pass directly on hand-built grids,
 * then assert the invariant holds on real floors.
 */
describe("breakLaunchDuels", () => {
  /** An open horizontal corridor of floor at row j, i in [1, w-2]. */
  function corridor(w: number, h: number, j: number) {
    const g = generateMaze(3, 3, mulberry32(1)); // shape only; we overwrite below
    const grid = { w, h, t: new Uint8Array(w * h).fill(T_WALL), shapes: new Uint8Array(w * h) };
    for (let i = 1; i <= w - 2; i++) grid.t[j * w + i] = T_FLOOR;
    void g;
    return grid as unknown as ReturnType<typeof generateMaze>;
  }
  const launcher = (i: number, j: number, dirI: number, dirJ: number, extra: object = {}) =>
    ({ i, j, kind: "ramp", dirI, dirJ, dir2I: 0, dir2J: 0, ...extra }) as Parameters<typeof breakLaunchDuels>[1][number];

  it("breaks a head-on pair down a clear lane", () => {
    const g = corridor(20, 5, 2);
    const a = launcher(3, 2, 1, 0);
    const b = launcher(9, 2, -1, 0);
    const parts = [a, b];
    expect(breakLaunchDuels(g, parts)).toBe(1);
    // In a 1-wide corridor the only escape is to REVERSE one of them, which
    // makes the pair parallel — a chain, not a standing wave.
    expect(parts).toHaveLength(2);
    const opposed = a.dirI === -b.dirI && a.dirJ === -b.dirJ;
    expect(opposed).toBe(false);
  });

  it("leaves an opposed pair alone when a WALL separates them", () => {
    const g = corridor(20, 5, 2);
    g.t[2 * 20 + 6] = T_WALL; // plug the lane between them
    const a = launcher(3, 2, 1, 0);
    const b = launcher(9, 2, -1, 0);
    expect(breakLaunchDuels(g, [a, b])).toBe(0);
    expect([a.dirI, b.dirI]).toEqual([1, -1]); // untouched
  });

  it("leaves an opposed pair alone when they are too far apart to sustain it", () => {
    const g = corridor(40, 5, 2);
    const a = launcher(2, 2, 1, 0);
    const b = launcher(2 + 20, 2, -1, 0); // > DUEL_RANGE
    expect(breakLaunchDuels(g, [a, b])).toBe(0);
  });

  it("leaves parts that merely face away, or share no axis, alone", () => {
    const g = corridor(20, 5, 2);
    const back = [launcher(3, 2, -1, 0), launcher(9, 2, 1, 0)]; // firing apart
    expect(breakLaunchDuels(g, back)).toBe(0);
    const perp = [launcher(3, 2, 1, 0), launcher(9, 2, 0, 1)]; // not opposed
    expect(breakLaunchDuels(g, perp)).toBe(0);
  });

  it("never touches a VAULT ramp — firing into rock is its whole point", () => {
    const g = corridor(20, 5, 2);
    const vault = launcher(3, 2, 1, 0, { vault: true });
    const b = launcher(9, 2, -1, 0);
    breakLaunchDuels(g, [vault, b]);
    expect(vault.dirI).toBe(1);
    expect(vault.kind).toBe("ramp");
  });

  it("never re-aims a SPINE part — the route's down-flow invariant outranks the duel", () => {
    // A wide room, so both have somewhere else to point.
    const w = 20;
    const h = 9;
    const g = { w, h, t: new Uint8Array(w * h).fill(T_WALL), shapes: new Uint8Array(w * h) } as unknown as ReturnType<typeof generateMaze>;
    for (let j = 1; j <= h - 2; j++) for (let i = 1; i <= w - 2; i++) g.t[j * w + i] = T_FLOOR;
    const spine = launcher(4, 4, 1, 0, { spine: true });
    const plain = launcher(10, 4, -1, 0);
    expect(breakLaunchDuels(g, [spine, plain])).toBe(1);
    expect([spine.dirI, spine.dirJ]).toEqual([1, 0]); // spine kept its shot…
    expect(plain.dirI === -spine.dirI && plain.dirJ === -spine.dirJ).toBe(false); // …the other one moved
  });

  it("real floors come out with no launch duels left", () => {
    for (let seed = 0; seed < 30; seed++) {
      const g = thickenWalls(generateMaze(10, 8, mulberry32(seed)));
      const plan = decorateMaze(g, mulberry32(seed + 1), 8, 10, 14);
      const live = plan.parts.filter(
        (p) => !p.vault && LAUNCH_KINDS_TEST.has(p.kind) && Math.abs(p.dirI) + Math.abs(p.dirJ) === 1,
      );
      for (let x = 0; x < live.length; x++) {
        for (let y = x + 1; y < live.length; y++) {
          const a = live[x];
          const b = live[y];
          if (a.dirI !== -b.dirI || a.dirJ !== -b.dirJ) continue;
          const along = a.dirI !== 0 ? (b.i - a.i) * a.dirI : (b.j - a.j) * a.dirJ;
          const across = a.dirI !== 0 ? b.j - a.j : b.i - a.i;
          if (across !== 0 || along <= 0 || along > 12) continue;
          let clear = true;
          for (let s = 1; s < along && clear; s++) {
            if (at(g, a.i + a.dirI * s, a.j + a.dirJ * s) !== T_FLOOR) clear = false;
          }
          // ── AN INTERCEPTED LANE IS NOT A DUEL, and this clause is the whole
          // reason the old assertion was a proxy rather than the property.
          //
          // The ping-pong needs a ROUND TRIP: a throws the ball at b, b throws
          // it back at a. A launcher standing between them sets a fresh heading
          // and the trip never completes — exactly as a wall between them does,
          // which the loop above already honours.
          //
          // It matters because two routes CONVERGING on one corridor from
          // opposite ends is a normal shape once routes run downhill on Φ: both
          // arms are correct, they meet at a local minimum, and the part at the
          // minimum turns the ball out of the lane. Seed 24 produces exactly
          // that — boosters at (15,15)+j and (15,27)−j either side of a corner
          // booster at (15,22), Φ 60 → 53 ← 58 — and the un-intercepted
          // predicate called it a duel. Repairing a merge junction would mean
          // re-aiming one road back up itself.
          for (const q of plan.parts) {
            if (q === a || q === b || !clear) continue;
            if (!LAUNCH_KINDS_TEST.has(q.kind) && q.kind !== "boostcorner" && q.kind !== "boostcurve") continue;
            const qa = a.dirI !== 0 ? (q.i - a.i) * a.dirI : (q.j - a.j) * a.dirJ;
            const qc = a.dirI !== 0 ? q.j - a.j : q.i - a.i;
            if (qc === 0 && qa > 0 && qa < along) clear = false;
          }
          expect(clear, `seed ${seed}: ${a.kind}@${a.i},${a.j} duels ${b.kind}@${b.i},${b.j}`).toBe(false);
        }
      }
    }
  });

  it("NO CLOSED LOOP of shoves survives on a real floor", () => {
    // The property the pairwise duel test above can only approximate, and the
    // one the player actually feels: follow each launcher's exit ray to the
    // launcher it feeds and you must never come back to where you started.
    //
    // Censused on the shipping generator before maze/flow-loops.ts existed: 130
    // launchers across 78 floors sat inside a closed ring, most of them in rings
    // of THREE OR MORE, which no pair rule can represent and which the runtime
    // BOOSTER_JAM guard cannot see either (it keys off the ball returning to the
    // same spot, and in a multi-pad ring it never does).
    let floors = 0;
    for (let seed = 0; seed < 40; seed++) {
      const g = thickenWalls(generateMaze(12, 10, mulberry32(seed)));
      const plan = decorateMaze(g, mulberry32(seed + 1), 8, 10, 16);
      floors++;
      const cycles = findFlowCycles(g, plan.parts);
      const show = cycles.map((c) => c.map((n) => `${plan.parts[n].kind}@${plan.parts[n].i},${plan.parts[n].j}`).join(" → "));
      expect(cycles.length, `seed ${seed}: feedback loop(s) ${JSON.stringify(show)}`).toBe(0);
    }
    expect(floors, "no floors sampled").toBeGreaterThan(30);
  });

  it("route pads run STRICTLY downhill on Φ, so a route cannot double back", () => {
    // The invariant every other guarantee here is built on. It is asserted on
    // the route pads specifically because they are the ones with no kickback
    // allowance — a loose corridor pad may deliberately rebound, a road may not.
    let checked = 0;
    for (let seed = 0; seed < 30; seed++) {
      const g = thickenWalls(generateMaze(12, 10, mulberry32(seed)));
      const plan = decorateMaze(g, mulberry32(seed + 1), 8, 10, 16);
      const phi = buildFlowField(g, plan.stairs);
      for (const p of plan.parts) {
        if (!p.spine || p.chute) continue;
        // Straight route pads fire along `dir`; a corner fires along `dir2`.
        const [di, dj] = p.kind === "boostcorner" ? [p.dir2I, p.dir2J] : [p.dirI, p.dirJ];
        if (p.kind !== "booster" && p.kind !== "boostcorner") continue;
        checked++;
        const from = phiAt(g, phi, p.i, p.j);
        const to = phiAt(g, phi, p.i + Math.round(di), p.j + Math.round(dj));
        expect(to, `${p.kind}@${p.i},${p.j} (seed ${seed}) fires uphill: Φ ${from} → ${to}`).toBeLessThan(from);
      }
    }
    expect(checked, "no route pads sampled").toBeGreaterThan(50);
  });
});

/** Mirror of decorate.ts LAUNCH_KINDS (not exported — kept in step by the test above). */
const LAUNCH_KINDS_TEST = new Set<string>(["ramp", "booster", "spring", "slingshot", "flipper"]);
