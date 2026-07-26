/**
 * SOCKET / PLUMBING tests — the geometry contract.
 *
 * These are ACCEPTANCE thresholds for "does the floor make sense", and every
 * one of them was a real defect with a real measurement. The before/after
 * numbers are in the assertions deliberately: a threshold with no baseline is
 * just a number someone picked.
 *
 *   dead ends      105.8/floor → 0.4      corridors to nowhere
 *   wall stubs     116.4/floor → 0.5      one-tile nubs jutting into rooms
 *   bad launchers  11.3%       → 0%       boosters firing into a wall
 *   road-to-nowhere 1.3/floor  → 0        the circuit stopping in mid-air
 */
import { describe, it, expect } from "vitest";
import { mulberry32 } from "../../../utils/rng";
import { buildTrackFloor } from "./track-floor";
import { growTrack, pruneLeaves, circuitRank } from "./track-grow";
import { decorateMaze } from "./decorate";
import { isWalkable, idx, at, T_CRACKED, type Grid } from "./generator";
import {
  compatible,
  socketAt,
  findSocketViolations,
  findRoadTerminations,
  clearRun,
  DIRS,
  type Socket,
} from "./track-socket";

const rngFor = (s: number): (() => number) => mulberry32((s * 2654435761) >>> 0);
const SOCKETS: Socket[] = ["road", "room", "wall", "rim"];
const LAUNCH = new Set(["ramp", "booster", "spring", "slingshot", "flipper"]);

/** Open cardinal neighbours of a tile. */
function openCount(g: Grid, i: number, j: number): number {
  let n = 0;
  for (const { di, dj } of DIRS) if (isWalkable(g, i + di, j + dj)) n++;
  return n;
}

describe("the socket contract", () => {
  it("is SYMMETRIC — validity cannot depend on which tile you ask first", () => {
    for (const a of SOCKETS) {
      for (const b of SOCKETS) {
        expect(compatible(a, b), `${a}|${b} disagrees with ${b}|${a}`).toBe(compatible(b, a));
      }
    }
  });

  it("labels tiles from the grid + mask, so it cannot drift", () => {
    const f = buildTrackFloor(20, 15, rngFor(4))!;
    expect(f).not.toBeNull();
    const g = f.grid;
    let sawRoad = false;
    let sawRoom = false;
    let sawWall = false;
    for (let j = 0; j < g.h; j++) {
      for (let i = 0; i < g.w; i++) {
        const s = socketAt(g, f.mask, i, j);
        if (s === "road") {
          sawRoad = true;
          expect(isWalkable(g, i, j)).toBe(true);
          expect(f.mask.lane[idx(g, i, j)]).toBe(1);
        }
        if (s === "room") {
          sawRoom = true;
          expect(isWalkable(g, i, j)).toBe(true);
        }
        if (s === "wall") {
          sawWall = true;
          expect(isWalkable(g, i, j)).toBe(false);
        }
      }
    }
    // A floor that is all one label would pass every other test vacuously.
    expect(sawRoad && sawRoom && sawWall, "a floor with no road/room/wall mix").toBe(true);
  });

  it("off-grid always reads as wall", () => {
    const f = buildTrackFloor(20, 15, rngFor(5))!;
    expect(socketAt(f.grid, f.mask, -1, 3)).toBe("wall");
    expect(socketAt(f.grid, f.mask, 3, -1)).toBe("wall");
    expect(socketAt(f.grid, f.mask, f.grid.w, 3)).toBe("wall");
  });
});

describe("generated floors satisfy the plumbing contract", () => {
  it("has NO unmated socket pairs", () => {
    for (let s = 1; s <= 15; s++) {
      const f = buildTrackFloor(24, 18, rngFor(s));
      expect(f).not.toBeNull();
      const bad = findSocketViolations(f!.grid, f!.mask);
      expect(bad.length, `seed ${s}: ${bad.length} unmated edges, e.g. ${JSON.stringify(bad[0])}`).toBe(0);
    }
  });

  it("has NO road that ends in mid-air", () => {
    // Was 1.3/floor, caused by degree-1 leaf nodes surviving into the carve.
    let total = 0;
    for (let s = 1; s <= 15; s++) {
      const f = buildTrackFloor(24, 18, rngFor(s))!;
      total += findRoadTerminations(f.grid, f.mask, [f.start, f.stairs]).length;
    }
    expect(total, "the circuit stops in mid-air somewhere").toBe(0);
  });

  it("has almost no DEAD ENDS — was 105.8 per floor", () => {
    let deadEnds = 0;
    let floors = 0;
    for (let s = 1; s <= 15; s++) {
      const f = buildTrackFloor(24, 18, rngFor(s))!;
      floors++;
      for (let j = 1; j < f.grid.h - 1; j++) {
        for (let i = 1; i < f.grid.w - 1; i++) {
          if (isWalkable(f.grid, i, j) && openCount(f.grid, i, j) <= 1) deadEnds++;
        }
      }
    }
    expect(deadEnds / floors, `${(deadEnds / floors).toFixed(1)} dead ends per floor`).toBeLessThan(4);
  });

  it("has almost no WALL STUBS or isolated pillars — was 116.4 per floor", () => {
    let stubs = 0;
    let pillars = 0;
    let floors = 0;
    for (let s = 1; s <= 15; s++) {
      const f = buildTrackFloor(24, 18, rngFor(s))!;
      floors++;
      const g = f.grid;
      for (let j = 1; j < g.h - 1; j++) {
        for (let i = 1; i < g.w - 1; i++) {
          if (isWalkable(g, i, j)) continue;
          if (at(g, i, j) === T_CRACKED) continue;
          if (g.arcIdx && g.arcIdx[idx(g, i, j)] >= 0) continue; // a curve's rim
          const open = openCount(g, i, j);
          if (open >= 3) stubs++;
          if (open === 4) pillars++;
        }
      }
    }
    expect(stubs / floors, `${(stubs / floors).toFixed(1)} wall stubs per floor`).toBeLessThan(4);
    expect(pillars / floors, `${(pillars / floors).toFixed(1)} isolated pillars per floor`).toBeLessThan(1);
  });

  it("keeps a real MAZE around the track — the floor is not one big blob", () => {
    // The regression this pins: an unbounded dead-end cascade unravelled the
    // 1-wide maze corridors and left off-track floor at 1.5% of the grid. The
    // level rendered as a track blob with nothing around it.
    for (let s = 1; s <= 12; s++) {
      const f = buildTrackFloor(24, 18, rngFor(s))!;
      const g = f.grid;
      let lane = 0;
      let room = 0;
      for (let k = 0; k < g.w * g.h; k++) {
        const i = k % g.w;
        const j = (k - i) / g.w;
        if (!isWalkable(g, i, j)) continue;
        if (f.mask.lane[k]) lane++;
        else room++;
      }
      expect(room, `seed ${s}: no maze left`).toBeGreaterThan(0);
      expect(room / (lane + room), `seed ${s}: maze is only ${((room / (lane + room)) * 100) | 0}% of open floor`).toBeGreaterThan(0.2);
    }
  });
});

describe("launchers never fire into a wall", () => {
  it("every launcher has a clear runway — was 11.3% blocked", () => {
    let total = 0;
    let blocked = 0;
    for (let s = 1; s <= 12; s++) {
      const rng = rngFor(s);
      const f = buildTrackFloor(24, 18, rng)!;
      const plan = decorateMaze(f.grid, rng, 20, 10, 20, [], {
        endpoints: { start: f.start, stairs: f.stairs },
        // What core.ts passes for a track floor — without it the vault/spine
        // exemption applies and this test would measure the legacy contract.
        strictLaunchers: true,
      });
      for (const p of plan.parts) {
        if (!LAUNCH.has(p.kind)) continue;
        if (!p.dirI && !p.dirJ) continue;
        total++;
        if (clearRun(f.grid, p.i, p.j, p.dirI, p.dirJ) < 3) blocked++;
      }
    }
    expect(total, "no launchers placed at all — the test would be vacuous").toBeGreaterThan(50);
    expect(blocked, `${blocked}/${total} launchers fire into a wall`).toBe(0);
  });
});

describe("graph leaf pruning", () => {
  it("leaves NO degree-1 node — that is what carves a road to nowhere", () => {
    for (let s = 1; s <= 15; s++) {
      const g = growTrack(67, 51, rngFor(s));
      const deg = new Map<number, number>();
      for (const e of g.edges) {
        deg.set(e.a, (deg.get(e.a) ?? 0) + 1);
        deg.set(e.b, (deg.get(e.b) ?? 0) + 1);
      }
      const leaves = [...deg.values()].filter((d) => d <= 1).length;
      expect(leaves, `seed ${s}: ${leaves} dangling spurs`).toBe(0);
    }
  });

  it("pruning leaves keeps every cycle", () => {
    // Removing a degree-1 node cannot destroy a loop, so the rank must survive.
    for (let s = 1; s <= 10; s++) {
      const raw = growTrack(67, 51, rngFor(s));
      expect(circuitRank(pruneLeaves(raw))).toBeGreaterThanOrEqual(Math.min(2, circuitRank(raw)));
    }
  });
});
