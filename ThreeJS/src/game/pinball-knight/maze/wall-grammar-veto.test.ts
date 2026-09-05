/**
 * THE CURVE VETOES — that they change what they claim, and NOTHING else.
 *
 * decorate.ts `assignCornerShapes` stops turning a wall tile into a quarter-
 * round shell where the run compiler says there is no wall to round off. The
 * dangerous part is not the rule, it is the blast radius: `grid.shapes` is read
 * by the COLLIDER (engine/tile-shape.ts — see = hit), so a veto that also moved
 * a tile, dropped an arc or reshaped something that was never a candidate would
 * change what the ball bounces off.
 *
 * So the gates come in two halves: the veto DID something, and the veto did
 * nothing else. Both matter — a neutrality proof alone passes if the flag is
 * dead, which is the classic way a feature ships switched off.
 */
import { describe, it, expect } from "vitest";
import { buildHeadlessPlan } from "../dev/headless-floor";
import { sweepPairs } from "./sweep-axis";
import { type Grid, idx } from "./generator";
import { SHAPE_FULL, SHAPE_ARC } from "../engine/tile-shape";
import { compileWallRuns, runLengthMask, runInteriorMask } from "./wall-runs";
import { checkPieces } from "./piece-rules";
import { findOrphanArcTiles } from "./arc-contract";

const PINS = [
  { level: 5, seed: 0x6057 },
  { level: 1, seed: 1 },
];
const PAIRS = (() => {
  const all = [...PINS];
  // Every archetype at both budget ends, plus two deep floors — the corpus the
  // rest of maze/ measures on. Trimmed to the SHALLOW half plus two DEEP pairs
  // because this file builds every floor TWICE.
  for (const p of sweepPairs()) {
    if (p.level <= 5 || p.level >= 27) {
      if (!all.some((q) => q.level === p.level && q.seed === p.seed)) all.push({ level: p.level, seed: p.seed });
    }
  }
  return all;
})();

interface Pair {
  level: number;
  seed: number;
  off: Grid;
  on: Grid;
}
const FLOORS: Pair[] = PAIRS.map(({ level, seed }) => {
  const off = buildHeadlessPlan(level, seed, false, false);
  const on = buildHeadlessPlan(level, seed, false, true);
  return off && on ? { level, seed, off: off.grid, on: on.grid } : null;
}).filter((p): p is Pair => p !== null);

const label = (p: Pair): string => `L${p.level} s${p.seed}`;

/**
 * The grid as `assignCornerShapes` saw it: every shape it could have written
 * stripped back to a plain box, arc slices (owned by arc-sweeps/arc-contract,
 * assigned long before) left alone.
 */
function preShapeGrid(g: Grid): Grid {
  const shapes = new Uint8Array(g.shapes);
  for (let k = 0; k < shapes.length; k++) if (shapes[k] !== SHAPE_ARC) shapes[k] = SHAPE_FULL;
  return { ...g, shapes } as Grid;
}

describe("the vetoes touch shapes and nothing else", () => {
  for (const p of FLOORS) {
    it(`leaves every TILE untouched on ${label(p)}`, () => {
      // SABOTAGE SEEN RED: `setTile(g, i, j, T_FLOOR)` in place of the veto.
      expect(p.on.t.length).toBe(p.off.t.length);
      let diff = 0;
      for (let k = 0; k < p.on.t.length; k++) if (p.on.t[k] !== p.off.t[k]) diff++;
      expect(diff, `${label(p)} tiles changed`).toBe(0);
    });

    it(`leaves every ARC untouched on ${label(p)}`, () => {
      expect(p.on.arcs?.length ?? 0).toBe(p.off.arcs?.length ?? 0);
      expect(JSON.stringify(p.on.arcs ?? [])).toBe(JSON.stringify(p.off.arcs ?? []));
      const a = p.on.arcIdx;
      const b = p.off.arcIdx;
      expect(Boolean(a)).toBe(Boolean(b));
      if (a && b) {
        let diff = 0;
        for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) diff++;
        expect(diff, `${label(p)} arcIdx changed`).toBe(0);
      }
    });

    it(`only ever REMOVES a shape, and never an arc slice, on ${label(p)}`, () => {
      // SABOTAGE SEEN RED: apply the veto to a tile that was not a candidate.
      let removed = 0;
      for (let k = 0; k < p.on.shapes.length; k++) {
        if (p.on.shapes[k] === p.off.shapes[k]) continue;
        expect(p.off.shapes[k], `${label(p)} tile ${k}`).not.toBe(SHAPE_FULL); // it HAD a shape
        expect(p.on.shapes[k], `${label(p)} tile ${k}`).toBe(SHAPE_FULL); // …and now it is a plain box
        expect(p.off.shapes[k]).not.toBe(SHAPE_ARC); // arcs belong to arc-contract, not to us
        removed++;
      }
      expect(removed).toBeGreaterThanOrEqual(0);
    });

    it(`introduces no piece-rule violation and no orphan arc on ${label(p)}`, () => {
      const before = checkPieces(p.off).length;
      const after = checkPieces(p.on).length;
      expect(after, `${label(p)} piece violations rose`).toBeLessThanOrEqual(before);
      expect(findOrphanArcTiles(p.on).length).toBe(0);
    });
  }
});

describe("the vetoes do something", () => {
  it("removes curves, and only where the run compiler says there is no wall", () => {
    // SABOTAGE SEEN RED: return before the veto loop — `removed` goes to 0.
    //
    // ⚠️ The masks have to be read off the grid PRODUCTION read them off: the
    // one before any shell was assigned. Reading them off the finished floor
    // scores 3,240 perfectly good removals as unexplained, because on that grid
    // the tile in question is a shell and therefore not part of any run at all.
    // `assignCornerShapes` is the last shape mutation and only ever writes
    // non-ARC shapes, so stripping those reconstructs its input exactly.
    let removed = 0;
    let onLongRun = 0;
    for (const p of FLOORS) {
      const pre = preShapeGrid(p.off);
      const runLen = runLengthMask(pre);
      const interior = runInteriorMask(pre, 3);
      for (let k = 0; k < p.on.shapes.length; k++) {
        if (p.on.shapes[k] === p.off.shapes[k]) continue;
        removed++;
        // Every removal is justified by ONE of the two rules, read off the grid
        // as it stood BEFORE any shape was assigned.
        const short = runLen[k] > 0 && runLen[k] <= 2;
        const mid = interior[k] === 1;
        if (!short && !mid) onLongRun++;
      }
    }
    expect(removed, "the flag changed nothing at all").toBeGreaterThan(100);
    expect(onLongRun, "a curve was removed that neither rule covers").toBe(0);
  });

  it("halves the number of run ends that a curve cuts", () => {
    let endsOff = 0;
    let endsOn = 0;
    for (const p of FLOORS) {
      for (const r of compileWallRuns(p.off, "runs").runs) endsOff += r.ends.filter((e) => e.kind === "shaped").length;
      for (const r of compileWallRuns(p.on, "runs").runs) endsOn += r.ends.filter((e) => e.kind === "shaped").length;
    }
    // Measured over the full 31-floor corpus: 10,755 -> 5,459. This asserts the
    // DIRECTION and a floor well under it, so a tuning change that erodes the
    // win fails while an improvement does not.
    expect(endsOn).toBeLessThan(endsOff * 0.8);
  });

  it("does not shorten the walls it was supposed to protect", () => {
    // The vetoes hand tiles BACK to the box set, so across the corpus there is
    // MORE wall standing in long runs, not less.
    //
    // Asserted on the total rather than per floor, and the exception is worth
    // recording: recovering a tile can lengthen a run in one axis past a run in
    // the other, which flips who owns a shared tile and re-segments the loser.
    // On L4 s1 that costs 2 tiles. Ownership moving is the corner rule working,
    // so a per-floor floor here would be a gate against the design.
    const tilesInLong = (g: Grid): number =>
      compileWallRuns(g, "runs").runs.reduce((n, r) => n + (r.n >= 4 ? r.n : 0), 0);
    let off = 0;
    let on = 0;
    for (const p of FLOORS) {
      off += tilesInLong(p.off);
      on += tilesInLong(p.on);
    }
    expect(on).toBeGreaterThanOrEqual(off);
  });
});
