/**
 * WALL-RUN COMPILER GATES.
 *
 * Every gate here is written so it can go RED, and each one was watched failing
 * once (the sabotage is named in its comment) before this file was committed.
 * A gate nobody has seen fail is a gate nobody has tested.
 *
 * The corpus is `sweepPairs()` plus the three pinned floors the screenshots use.
 * Floors are built ONCE at module scope: `buildTrackFloor` is ~96% of a sweep's
 * runtime (maze/sweep-axis.ts), so rebuilding per gate would cost minutes for
 * nothing.
 */
import { describe, it, expect } from "vitest";
import { buildHeadlessPlan } from "../dev/headless-floor";
import { sweepPairs } from "./sweep-axis";
import { type Grid, idx, isWalkable, isLowWall, at, shapeAt, T_WALL, T_FLOOR, T_CRACKED } from "./generator";
import { isShaped } from "../engine/tile-shape";
import {
  compileWallRuns,
  legacyTriage,
  classifyTiles,
  runInteriorMask,
  mossHash,
  K_BOX,
  CAP_N,
  CAP_E,
  CAP_S,
  CAP_W,
  CAP_ALL,
  type WallRunPlan,
} from "./wall-runs";
import fixture from "../dev/fixtures/wall-legacy-triage.json";

// ── corpus ───────────────────────────────────────────────────────────────────

const PINS = [
  { level: 5, seed: 0x6057 }, // the default Ghost Maze floor — the screenshot pin
  { level: 1, seed: 1 },
  { level: 24, seed: 1 },
];
const PAIRS = (() => {
  const all = [...PINS];
  for (const p of sweepPairs()) {
    if (!all.some((q) => q.level === p.level && q.seed === p.seed)) all.push({ level: p.level, seed: p.seed });
  }
  return all;
})();

interface Floor {
  level: number;
  seed: number;
  grid: Grid;
}
const FLOORS: Floor[] = PAIRS.map(({ level, seed }) => {
  const plan = buildHeadlessPlan(level, seed);
  return plan ? { level, seed, grid: plan.grid } : null;
}).filter((f): f is Floor => f !== null);

const RUNS: Array<{ f: Floor; plan: WallRunPlan }> = FLOORS.map((f) => ({ f, plan: compileWallRuns(f.grid, "runs") }));
const TILES: Array<{ f: Floor; plan: WallRunPlan }> = FLOORS.map((f) => ({ f, plan: compileWallRuns(f.grid, "tiles") }));

const label = (f: Floor): string => `L${f.level} s${f.seed}`;
const boxCount = (g: Grid): number => {
  const kind = classifyTiles(g);
  let n = 0;
  for (let k = 0; k < kind.length; k++) if (kind[k] === K_BOX) n++;
  return n;
};

// ── G0: the legacy triage still is the legacy triage ─────────────────────────
// `legacyTriage` replaces an inline loop in maze/build.ts. The fixture holds
// digests of the ORIGINAL loop, byte-sliced out of build.ts at c9a05458 and run
// over these same floors, so this compares the replacement against the code it
// replaces — not against itself.
// SABOTAGE SEEN RED: moss hash 13 → 11.
describe("G0 legacy triage parity", () => {
  const fnv = (s: string): string => {
    let h = 0x811c9dc5;
    for (let k = 0; k < s.length; k++) {
      h ^= s.charCodeAt(k);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  };
  const setDigest = (cells: Array<{ i: number; j: number }>): string => fnv(cells.map((c) => `${c.i},${c.j}`).sort().join(";"));

  it("the fixture covers every corpus floor", () => {
    expect(fixture.floors.length).toBeGreaterThanOrEqual(FLOORS.length);
    for (const f of FLOORS) {
      expect(fixture.floors.some((r) => r.level === f.level && r.seed === f.seed), label(f)).toBe(true);
    }
  });

  for (const f of FLOORS) {
    it(`reproduces build.ts's original scan on ${label(f)}`, () => {
      const row = fixture.floors.find((r) => r.level === f.level && r.seed === f.seed)!;
      const t = legacyTriage(f.grid);
      expect({ w: f.grid.w, h: f.grid.h }).toEqual({ w: row.w, h: row.h });
      expect({
        full: t.full.length,
        moss: t.moss.length,
        low: t.low.length,
        south: t.southFaces.length,
        slant: t.slant.length,
        arcRim: t.arcRim.size,
      }).toEqual(row.counts);
      expect({
        full: setDigest(t.full),
        moss: setDigest(t.moss),
        low: setDigest(t.low),
        south: setDigest(t.southFaces),
        slant: setDigest(t.slant),
      }).toEqual(row.digest);
    });
  }

  it("emits cells in row-major order — instance indices are a runtime contract", () => {
    // MazeHandle.wallAt maps a tile to (mesh, instance index); secrets.ts and
    // entities/wall-erosion.ts write through it. Order is not cosmetic.
    for (const f of FLOORS) {
      const t = legacyTriage(f.grid);
      for (const list of [t.full, t.moss, t.low, t.southFaces]) {
        for (let k = 1; k < list.length; k++) {
          const a = list[k - 1];
          const b = list[k];
          expect(b.j * f.grid.w + b.i, label(f)).toBeGreaterThan(a.j * f.grid.w + a.i);
        }
      }
    }
  });
});

// ── G1: coverage ─────────────────────────────────────────────────────────────
// SABOTAGE SEEN RED: skip the ownership re-segment, so a corner tile joins two
// runs — pieces.length then exceeds the box count.
describe("G1 coverage", () => {
  for (const { f, plan } of RUNS) {
    it(`covers every drawn box exactly once on ${label(f)}`, () => {
      const g = f.grid;
      expect(plan.pieces.length).toBe(boxCount(g));
      const kind = classifyTiles(g);
      const seen = new Set<number>();
      for (const p of plan.pieces) {
        const k = idx(g, p.i, p.j);
        expect(kind[k], `${p.i},${p.j}`).toBe(K_BOX);
        expect(seen.has(k)).toBe(false);
        seen.add(k);
        expect(plan.pieceAt[k]).toBe(plan.pieces.indexOf(p) >= 0 ? plan.pieceAt[k] : -1);
        expect(plan.pieces[plan.pieceAt[k]]).toBe(p);
        // Attributes are the grid's, not a second opinion about it.
        expect(p.low).toBe(isLowWall(g, p.i, p.j));
        expect(p.faceS).toBe(isWalkable(g, p.i, p.j + 1));
        expect(p.faceE).toBe(isWalkable(g, p.i + 1, p.j));
      }
      for (let k = 0; k < kind.length; k++) {
        if (kind[k] !== K_BOX) expect(plan.pieceAt[k]).toBe(-1);
        else expect(plan.pieceAt[k]).toBeGreaterThanOrEqual(0);
      }
    });
  }
});

// ── G2: run arithmetic ───────────────────────────────────────────────────────
// SABOTAGE SEEN RED: give the run head the `body` role.
describe("G2 run arithmetic", () => {
  for (const { f, plan } of RUNS) {
    it(`every run is ends + middle, and the runs tile the walls on ${label(f)}`, () => {
      const g = f.grid;
      let total = 0;
      for (const run of plan.runs) {
        total += run.n;
        expect(run.n).toBeGreaterThan(0);
        const di = run.axis === "x" ? 1 : 0;
        const dj = run.axis === "x" ? 0 : 1;
        for (let p = 0; p < run.n; p++) {
          const piece = plan.pieces[plan.pieceAt[idx(g, run.i0 + di * p, run.j0 + dj * p)]];
          expect(piece, `${label(f)} run ${run.id} pos ${p}`).toBeTruthy();
          expect(piece.run).toBe(run.id);
          expect(piece.low).toBe(run.low);
          if (run.n === 1) expect(["solo", "corner"]).toContain(piece.role);
          else if (p === 0 || p === run.n - 1) expect(["end", "corner"]).toContain(piece.role);
          else expect(["body", "tee"]).toContain(piece.role);
        }
      }
      expect(total).toBe(plan.pieces.length);
      // A run of n >= 3 has exactly two extremities and n-2 middles.
      const long = plan.runs.filter((r) => r.n >= 3);
      for (const run of long) {
        const di = run.axis === "x" ? 1 : 0;
        const dj = run.axis === "x" ? 0 : 1;
        let mids = 0;
        for (let p = 1; p < run.n - 1; p++) {
          const piece = plan.pieces[plan.pieceAt[idx(g, run.i0 + di * p, run.j0 + dj * p)]];
          if (piece.role === "body" || piece.role === "tee") mids++;
        }
        expect(mids).toBe(run.n - 2);
      }
    });
  }
});

// ── G3: a junction is owned exactly once ─────────────────────────────────────
// SABOTAGE SEEN RED: let the z-run keep a tile the x-run also owns (drop the
// ownerX check in the re-segment walk).
describe("G3 corner ownership", () => {
  for (const { f, plan } of RUNS) {
    it(`no corner is capped by both arms on ${label(f)}`, () => {
      const g = f.grid;
      for (const run of plan.runs) {
        const di = run.axis === "x" ? 1 : 0;
        const dj = run.axis === "x" ? 0 : 1;
        const sides: Array<[number, number]> = [
          [run.i0 - di, run.j0 - dj],
          [run.i0 + di * run.n, run.j0 + dj * run.n],
        ];
        run.ends.forEach((e, s) => {
          if (!e.kind.startsWith("corner") && e.kind !== "tee") return;
          expect(e.other, `${label(f)} run ${run.id}`).toBeDefined();
          const other = plan.runs[e.other!];
          expect(other.axis).not.toBe(run.axis);
          const [bi, bj] = sides[s];
          const piece = plan.pieces[plan.pieceAt[idx(g, bi, bj)]];
          expect(piece).toBeTruthy();
          expect(piece.run).toBe(other.id);
          // The tile on the other side of the seam owns the junction.
          expect(e.kind === "tee" ? "tee" : "corner").toBe(piece.role);
        });
      }
    });
  }
});

// ── G4: no cap seam inside a run (Look A) ────────────────────────────────────
// SABOTAGE SEEN RED: compute cap masks with the same-run test disabled.
describe("G4 no border inside a run", () => {
  for (const { f, plan } of RUNS) {
    it(`a run's middle never draws an along-axis border on ${label(f)}`, () => {
      const g = f.grid;
      let bodies = 0;
      for (const run of plan.runs) {
        if (run.n < 3) continue;
        const di = run.axis === "x" ? 1 : 0;
        const dj = run.axis === "x" ? 0 : 1;
        const alongBits = run.axis === "x" ? CAP_E | CAP_W : CAP_N | CAP_S;
        for (let p = 1; p < run.n - 1; p++) {
          const piece = plan.pieces[plan.pieceAt[idx(g, run.i0 + di * p, run.j0 + dj * p)]];
          expect(piece.capMask & alongBits, `${label(f)} run ${run.id} pos ${p}`).toBe(0);
          expect(piece.capMask).not.toBe(CAP_ALL);
          bodies++;
        }
      }
      expect(bodies).toBeGreaterThan(0); // a floor with no wall middles would make this vacuous
    });
  }

  it("a border is drawn wherever the wall mass actually ends", () => {
    for (const { f, plan } of RUNS) {
      const g = f.grid;
      for (const p of plan.pieces) {
        const sides: Array<[number, number, number]> = [
          [0, -1, CAP_N],
          [1, 0, CAP_E],
          [0, 1, CAP_S],
          [-1, 0, CAP_W],
        ];
        for (const [di, dj, bit] of sides) {
          const nk = plan.pieceAt[
            p.i + di < 0 || p.j + dj < 0 || p.i + di >= g.w || p.j + dj >= g.h ? 0 : idx(g, p.i + di, p.j + dj)
          ];
          const neighbourDrawn =
            p.i + di >= 0 && p.j + dj >= 0 && p.i + di < g.w && p.j + dj < g.h && nk >= 0 && plan.pieces[nk].low === p.low;
          expect(Boolean(p.capMask & bit), `${label(f)} ${p.i},${p.j}`).toBe(!neighbourDrawn);
        }
      }
    }
  });
});

// ── G5: set-dressing sits on run middles only ────────────────────────────────
// SABOTAGE SEEN RED: filter `role !== "solo"` instead of `role === "body"`.
describe("G5 dressing", () => {
  it("pilaster/banner candidates are run middles, never ends", () => {
    for (const { f, plan } of RUNS) {
      const dress = plan.pieces.filter((p) => p.role === "body" && !p.low && p.faceS);
      expect(dress.length).toBeGreaterThan(0);
      for (const p of dress) {
        expect(["end", "corner", "solo"]).not.toContain(p.role);
        expect(isWalkable(f.grid, p.i, p.j + 1)).toBe(true);
        expect(isLowWall(f.grid, p.i, p.j)).toBe(false);
      }
      // …and they are a subset of the faces the shipped renderer dresses.
      const legacySouth = new Set(legacyTriage(f.grid).southFaces.map((c) => `${c.i},${c.j}`));
      for (const p of dress) expect(legacySouth.has(`${p.i},${p.j}`), `${label(f)} ${p.i},${p.j}`).toBe(true);
    }
  });
});

// ── G6: reserved footprints ──────────────────────────────────────────────────
// SABOTAGE SEEN RED: drop the isShaped branch from classifyTiles.
describe("G6 footprint exclusion", () => {
  it("never emits a box on floor, a secret band, or curved geometry", () => {
    for (const { f, plan } of RUNS) {
      for (const p of plan.pieces) {
        expect(isWalkable(f.grid, p.i, p.j), `${label(f)} ${p.i},${p.j}`).toBe(false);
        expect(at(f.grid, p.i, p.j)).not.toBe(T_CRACKED);
        expect(isShaped(shapeAt(f.grid, p.i, p.j))).toBe(false);
      }
    }
  });
});

// ── G7: what the run look draws is what the shipped look draws ───────────────
// SABOTAGE SEEN RED: read the south face from j-1.
describe("G7 render parity with the shipped triage", () => {
  for (const { f, plan } of RUNS) {
    it(`draws the same tiles at the same heights as build.ts on ${label(f)}`, () => {
      const t = legacyTriage(f.grid);
      const legacyTall = new Set([...t.full, ...t.moss].map((c) => `${c.i},${c.j}`));
      const legacyLow = new Set(t.low.map((c) => `${c.i},${c.j}`));
      const runTall = new Set(plan.pieces.filter((p) => !p.low).map((p) => `${p.i},${p.j}`));
      const runLow = new Set(plan.pieces.filter((p) => p.low).map((p) => `${p.i},${p.j}`));
      expect([...runTall].sort()).toEqual([...legacyTall].sort());
      expect([...runLow].sort()).toEqual([...legacyLow].sort());
    });
  }
});

// ── G8: the tiles look is the shipped look, run-aware ────────────────────────
// SABOTAGE SEEN RED: return a partial mask for "tiles".
describe("G8 tiles look", () => {
  it("keeps the per-tile square everywhere, and moss whole-run", () => {
    for (const { f, plan } of TILES) {
      for (const p of plan.pieces) expect(p.capMask).toBe(CAP_ALL);
      for (const run of plan.runs) {
        const mem = plan.pieces.filter((p) => p.run === run.id);
        const mossy = new Set(mem.map((p) => p.moss));
        expect(mossy.size).toBe(1); // whole run or none — never a dither inside one wall
        if (run.low) expect(mossy.has(false)).toBe(true);
      }
      // The moss decision is still the shipped hash, just asked once.
      for (const run of plan.runs) {
        expect(run.moss).toBe(!run.low && mossHash(run.i0, run.j0));
      }
    }
  });

  it("draws the same tile set as the runs look — only the seams differ", () => {
    for (let k = 0; k < RUNS.length; k++) {
      const a = RUNS[k].plan;
      const b = TILES[k].plan;
      expect(b.pieces.map((p) => `${p.i},${p.j},${p.low}`)).toEqual(a.pieces.map((p) => `${p.i},${p.j},${p.low}`));
    }
  });
});

// ── G11: hand-built grids, where the expected answer is written out ──────────
// A corpus gate says "nothing contradicts itself". These say what the model IS.
describe("G11 hand grids", () => {
  const makeGrid = (rows: string[]): Grid => {
    const h = rows.length;
    const w = rows[0].length;
    const t = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) t[j * w + i] = rows[j][i] === "." ? T_FLOOR : T_WALL;
    }
    return { w, h, t, shapes: new Uint8Array(w * h) } as Grid;
  };

  it("a 1-thick partition with floor on both sides is ONE run", () => {
    //  floor above (north) makes every tile low; floor below gives a south face.
    const g = makeGrid([
      "........",
      ".######.",
      "........",
    ]);
    const plan = compileWallRuns(g, "runs");
    expect(plan.pieces.length).toBe(6);
    expect(plan.runs.length).toBe(1);
    const run = plan.runs[0];
    expect({ axis: run.axis, n: run.n, low: run.low, faces: run.faces }).toEqual({ axis: "x", n: 6, low: true, faces: 6 });
    expect(run.ends.map((e) => e.kind)).toEqual(["open", "open"]);
    const mid = plan.pieces.find((p) => p.i === 3)!;
    expect(mid.role).toBe("body");
    expect(mid.capMask & (CAP_E | CAP_W)).toBe(0); // no seam inside the wall
    expect(mid.capMask & (CAP_N | CAP_S)).toBe(CAP_N | CAP_S); // outline kept
  });

  it("an L gives the corner to the longer arm, and the short arm reads as a corner end", () => {
    const g = makeGrid([
      ".........",
      ".#######.",
      ".#.......",
      ".#.......",
      ".........",
    ]);
    const plan = compileWallRuns(g, "runs");
    const xRun = plan.runs.find((r) => r.axis === "x")!;
    const zRun = plan.runs.find((r) => r.axis === "z")!;
    expect(plan.runs.length).toBe(2);
    expect(xRun.n).toBe(7); // the corner (1,1) belongs to the 7-long arm
    expect(zRun.n).toBe(2); // …so the vertical arm is (1,2)-(1,3)
    expect(zRun.ends[0].kind).toMatch(/^corner-/);
    expect(zRun.ends[0].other).toBe(xRun.id);
    const corner = plan.pieces.find((p) => p.i === 1 && p.j === 1)!;
    expect(corner.role).toBe("corner");
    expect(corner.run).toBe(xRun.id);
    // Every tile is in exactly one run: 7 + 2 = 9 pieces, no double-capping.
    expect(plan.pieces.length).toBe(9);
  });

  it("a run that ends against another run's middle is a tee", () => {
    const g = makeGrid([
      ".........",
      ".#######.",
      "...#.....",
      "...#.....",
      ".........",
    ]);
    const plan = compileWallRuns(g, "runs");
    const stem = plan.runs.find((r) => r.axis === "z")!;
    expect(stem.n).toBe(2);
    expect(stem.ends[0].kind).toBe("tee");
    const hit = plan.pieces.find((p) => p.i === 3 && p.j === 1)!;
    expect(hit.role).toBe("tee");
  });

  it("a 2-thick band is two runs, because the west column is knee-high and the east is not", () => {
    const g = makeGrid([
      "......",
      "..##..",
      "..##..",
      "..##..",
      "......",
    ]);
    const plan = compileWallRuns(g, "runs");
    const zs = plan.runs.filter((r) => r.axis === "z");
    expect(zs.length).toBe(2);
    const west = zs.find((r) => r.i0 === 2)!;
    const east = zs.find((r) => r.i0 === 3)!;
    expect(west.low).toBe(true); // floor to its west
    expect(east.low).toBe(false); // backed on north and west by stone
    expect(west.ends.map((e) => e.kind)).toEqual(["open", "open"]);
    // The two columns are different heights, so the seam between them stays.
    const w1 = plan.pieces.find((p) => p.i === 2 && p.j === 2)!;
    expect(w1.capMask & CAP_E).toBe(CAP_E);
  });

  it("a lone pillar is a solo, bordered on every side", () => {
    const g = makeGrid([
      ".....",
      "..#..",
      ".....",
    ]);
    const plan = compileWallRuns(g, "runs");
    expect(plan.pieces.length).toBe(1);
    expect(plan.pieces[0].role).toBe("solo");
    expect(plan.pieces[0].capMask).toBe(CAP_ALL);
    expect(plan.runs[0].n).toBe(1);
  });

  it("buried stone is not drawn, and a hole inside a run is counted not drawn", () => {
    // Two floor pockets light up (1,2) and (3,2) diagonally; (2,2) between them
    // touches no floor at all, so the shipped renderer skips it and the run has
    // a one-tile hole. `bridgeable` is how many such holes there are — the
    // number that says whether bridging them is worth a knob.
    const g = makeGrid([
      "######",
      ".###.#",
      "######",
      "######",
    ]);
    const plan = compileWallRuns(g, "runs");
    expect(plan.pieceAt[idx(g, 2, 2)]).toBe(-1);
    expect(plan.pieceAt[idx(g, 1, 2)]).toBeGreaterThanOrEqual(0);
    expect(plan.pieceAt[idx(g, 3, 2)]).toBeGreaterThanOrEqual(0);
    expect(plan.stats.bridgeable).toBeGreaterThan(0);
  });

  it("runInteriorMask marks middles and never ends", () => {
    const g = makeGrid([
      "........",
      ".######.",
      "........",
    ]);
    const mask = runInteriorMask(g);
    expect(mask[idx(g, 1, 1)]).toBe(0); // end
    expect(mask[idx(g, 6, 1)]).toBe(0); // end
    for (let i = 2; i <= 5; i++) expect(mask[idx(g, i, 1)]).toBe(1);
  });
});

// ── Corpus shape: what the runs actually look like on real floors ────────────
// Not a pass/fail rule — a printed measurement, so a future change to the
// mate predicate shows up as a number moving rather than as a feeling.
describe("corpus shape", () => {
  it("reports run lengths and what ends them", () => {
    let boxes = 0;
    let runs = 0;
    const ends: Record<string, number> = {};
    const lens: Record<number, number> = {};
    for (const { plan } of RUNS) {
      boxes += plan.stats.boxes;
      runs += plan.stats.runs;
      for (const [k, v] of Object.entries(plan.stats.byEnd)) ends[k] = (ends[k] ?? 0) + v;
      for (const [k, v] of Object.entries(plan.stats.byLen)) lens[Number(k)] = (lens[Number(k)] ?? 0) + v;
    }
    const top = Object.entries(ends).sort((a, b) => b[1] - a[1]);
    // eslint-disable-next-line no-console
    console.log(
      `[wall-runs] ${FLOORS.length} floors — ${boxes} boxes in ${runs} runs (mean ${(boxes / runs).toFixed(2)} tiles/run)\n` +
        `  lengths ${Object.entries(lens).sort((a, b) => Number(a[0]) - Number(b[0])).map(([k, v]) => `${k}:${v}`).join(" ")}\n` +
        `  ends    ${top.map(([k, v]) => `${k}:${v}`).join(" ")}`,
    );
    expect(runs).toBeGreaterThan(0);
  });
});
