/**
 * The funnel pass is OFF by default (it does not pay for itself yet — see the
 * module header). These are the invariants that must hold WHEN IT IS ON, so
 * that turning it on is a question about capture rate and never about whether
 * the floor is still a floor.
 *
 * Run against real generated floors with the switch flipped, because every
 * defect this pass could plausibly cause is a defect about real geometry:
 * stranding, an opening quietly widened, a curve with no stone behind it.
 */
import { describe, it, expect } from "vitest";
import { buildHeadlessFloor } from "../dev/headless-floor";
import { findArcJunctions, backedFraction } from "./arc-contract";
import { measureDoorway, DOORWAY_WIDTHS } from "./doorways";
import { bfsDistances } from "../engine/flow-field";
import { isWalkable, idx, T_STAIRS, at } from "./generator";
import { parabolicJaws } from "./conic-fit";

const SEEDS = [1, 12345, 424242];
const LEVELS = [1, 5, 12];

const floors = (funnels: boolean) =>
  SEEDS.flatMap((s) => LEVELS.map((l) => buildHeadlessFloor(l, s, funnels))).filter((f) => f !== null);

describe("doorway funnels, with the switch on", () => {
  it("strands nothing", () => {
    // The one that must never regress. The pass FILLS as well as carves, so it
    // can close a route; the guard unwinds jaws one at a time until it cannot.
    for (const f of floors(true)) {
      const d = bfsDistances(f.grid, f.start.i, f.start.j);
      let stranded = 0;
      for (let j = 0; j < f.grid.h; j++) {
        for (let i = 0; i < f.grid.w; i++) if (isWalkable(f.grid, i, j) && d[idx(f.grid, i, j)] < 0) stranded++;
      }
      expect(stranded, `level ${f.level} seed ${f.runSeed}`).toBe(0);
    }
  });

  it("never widens the opening it feeds", () => {
    // The jaws meet the jambs AT the threshold, so a funnel tapers the corridor
    // into the door and never the door itself. This is `doorways.ts`'s
    // vocabulary invariant, which measured 17% of openings finishing wider than
    // authored before `jambsSurvive` existed.
    for (const f of floors(true)) {
      for (const d of f.doorways) {
        expect(measureDoorway(f.grid, d)).toBeLessThanOrEqual(DOORWAY_WIDTHS[0]);
      }
    }
  });

  it("leaves no curve without stone behind it", () => {
    for (const f of floors(true)) {
      for (const a of f.grid.arcs ?? []) {
        if (a.owner !== "funnel") continue;
        expect(backedFraction(f.grid, a)).toBeGreaterThan(0.5);
      }
    }
  });

  it("adds no incoherent junction — a funnel meets its neighbours as one wall", () => {
    for (const f of floors(true)) {
      expect(findArcJunctions(f.grid, true)).toHaveLength(0);
    }
  });

  it("never closes the stairs", () => {
    for (const f of floors(true)) {
      expect(at(f.grid, f.stairs.i, f.stairs.j)).toBe(T_STAIRS);
    }
  });

  it("commits both arms of a doorway or neither", () => {
    // A lone arm is a diagonal deflector beside an opening, and it measured
    // WORSE than a square threshold (-2.3pp capture, +3.7pp rejection). Arms
    // are committed as a pair; the strand guard may still unwind one, so this
    // asserts the authoring rule on a floor where nothing was unwound.
    for (const f of floors(true)) {
      const funnels = (f.grid.arcs ?? []).filter((a) => a.owner === "funnel");
      if (funnels.length === 0) continue;
      // Arms come in chains of FUNNEL_SEGMENTS; a complete pair is an even
      // number of features per doorway. Cheap proxy for the pairing rule, and
      // the one an odd-count bug would break.
      expect(funnels.length % 2).toBe(0);
    }
  });

  it("is genuinely off by default — floors are byte-identical without the switch", () => {
    // The whole reason a default-off feature is safe to keep in the tree.
    for (const s of SEEDS) {
      for (const l of LEVELS) {
        const off = buildHeadlessFloor(l, s, false)!;
        const plain = buildHeadlessFloor(l, s)!;
        expect(Array.from(plain.grid.t)).toEqual(Array.from(off.grid.t));
        expect(Array.from(plain.grid.shapes)).toEqual(Array.from(off.grid.shapes));
        expect((plain.grid.arcs ?? []).length).toBe((off.grid.arcs ?? []).length);
      }
    }
  });
});

describe("the jaw geometry a doorway asks for", () => {
  it("meets the jambs of every vocabulary width", () => {
    for (const w of DOORWAY_WIDTHS) {
      const { left, right, curvedDepth } = parabolicJaws({ x: 0, z: 0 }, { x: 1, z: 0 }, w, 4);
      expect(left.length).toBeGreaterThan(0);
      expect(right.length).toBeGreaterThan(0);
      expect(curvedDepth).toBeGreaterThan(0);
      // Concave: stone outside, ball inside. A convex jaw would push the ball
      // AWAY from the mouth, and `junctionCheck` would read the pair as a flip.
      for (const a of [...left, ...right]) expect(a.solidOut).toBe(true);
    }
  });
});
