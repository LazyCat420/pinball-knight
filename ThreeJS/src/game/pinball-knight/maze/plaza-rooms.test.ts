import { describe, expect, it } from "vitest";
import { authorFloor } from "../spawn/floor-authoring";
import { state } from "../state";
import { at, isWalkable, T_FLOOR } from "./generator";
import { DEFAULT_DENSITY } from "./floor-density";

/**
 * PLAZA A-1 — the Great Hall plaza reaches the decorator as a ROOM.
 *
 * What this exists to catch: for the whole life of the track generator,
 * `floor-authoring.ts` passed `rooms: []` on the shipping path, so
 * `furnishRooms`' four archetypes, their guards and prizes, and the map
 * overlay's per-archetype wash were unreachable on 100% of floors a player
 * ever saw. Measured on the commit before this one: 0 authored rooms across
 * 150 floors. Nothing was red, because nothing asked.
 *
 * The first assertion is therefore the important one, and it is deliberately
 * an existence claim about the SHIPPING path (`authorFloor`), not about
 * `furnishRooms` called directly — a unit test that hands `furnishRooms` a
 * room proves only that the function works, which was never in doubt.
 */

// Every 5th level is `greathall` (the one archetype with plazaFrac > 0), so a
// 1..30 sweep sees six of them per seed. Kept small: authorFloor is the whole
// pipeline and costs ~0.3 s a floor.
const SEEDS = [1, 424242, 12648430];
const LEVELS = Array.from({ length: 30 }, (_, k) => k + 1);

interface Sample {
  seed: number;
  level: number;
  rooms: Array<{ i0: number; j0: number; w: number; h: number; kind: string }>;
  parts: Array<{ i: number; j: number }>;
  spawns: Array<{ i: number; j: number }>;
  items: Array<{ i: number; j: number }>;
  grid: ReturnType<typeof authorFloor>["grid"];
  walkable: number;
}

function sweep(): Sample[] {
  const out: Sample[] = [];
  for (const seed of SEEDS) {
    for (const level of LEVELS) {
      state.runSeed = seed >>> 0;
      const { grid, plan } = authorFloor(level);
      let walkable = 0;
      for (let j = 0; j < grid.h; j++) for (let i = 0; i < grid.w; i++) if (isWalkable(grid, i, j)) walkable++;
      out.push({
        seed,
        level,
        rooms: plan.rooms as Sample["rooms"],
        parts: plan.parts as Sample["parts"],
        spawns: plan.spawns as Sample["spawns"],
        items: plan.items as Sample["items"],
        grid,
        walkable,
      });
    }
  }
  return out;
}

const SWEEP = sweep();
const WITH_ROOMS = SWEEP.filter((s) => s.rooms.length > 0);

describe("plaza rooms reach the decorator (A-1)", () => {
  it("a shipping floor authors rooms at all — the defect this wave fixed", () => {
    // The exact number is content and will move; that it is NOT ZERO is the
    // contract. Before A-1 this was 0 of 90.
    expect(WITH_ROOMS.length).toBeGreaterThan(0);
    // ...and it is the greathall archetype's floors, not a stray one. plazaFrac
    // is non-zero on exactly one of five archetypes, which rotate by level.
    expect(WITH_ROOMS.length / SWEEP.length).toBeGreaterThan(0.1);
    expect(WITH_ROOMS.length / SWEEP.length).toBeLessThan(0.35);
  });

  it("chamber rects are INTEGER tiles", () => {
    // `hub.x`/`hub.z` and the radius are floats, so an unrounded rect gives
    // `room.i0 + 1` a fractional tile index that addresses nothing and every
    // emission silently misses the grid. The first cut of A-1 shipped
    // 36.379999999999995 x 36.379999999999995 and furnished nothing while
    // every test stayed green.
    for (const s of WITH_ROOMS) {
      for (const r of s.rooms) {
        expect(Number.isInteger(r.i0), `i0 ${r.i0} @ seed ${s.seed} L${s.level}`).toBe(true);
        expect(Number.isInteger(r.j0), `j0 ${r.j0} @ seed ${s.seed} L${s.level}`).toBe(true);
        expect(Number.isInteger(r.w), `w ${r.w} @ seed ${s.seed} L${s.level}`).toBe(true);
        expect(Number.isInteger(r.h), `h ${r.h} @ seed ${s.seed} L${s.level}`).toBe(true);
      }
    }
  });

  it("a furnished plaza is actually furnished — the rect is not enough", () => {
    // Guards the integer regression from the other side: a rect can be integral
    // and still address rock if the clip is too aggressive. At least one part
    // must stand inside each authored room.
    for (const s of WITH_ROOMS) {
      for (const r of s.rooms) {
        const inside = s.parts.filter((p) => p.i >= r.i0 && p.i < r.i0 + r.w && p.j >= r.j0 && p.j < r.j0 + r.h);
        expect(inside.length, `no parts in ${r.kind} ${r.w}x${r.h} @ seed ${s.seed} L${s.level}`).toBeGreaterThan(0);
      }
    }
  });

  it("nothing is emitted onto rock — a disc's bounding rect has corners", () => {
    // The main correctness risk PLAZA_PLAN:440 names. `furnishRooms` indexes off
    // rect edges with a 1-tile margin, which is exact for carveRooms' rects and
    // false for a disc: ~21% of the bounding square is wall, concentrated in the
    // corners the arena guards and orbit rails aim at.
    let offFloor = 0;
    for (const s of WITH_ROOMS) {
      for (const r of s.rooms) {
        const inR = (i: number, j: number): boolean => i >= r.i0 && i < r.i0 + r.w && j >= r.j0 && j < r.j0 + r.h;
        for (const q of [...s.parts, ...s.spawns, ...s.items]) {
          if (inR(q.i, q.j) && at(s.grid, q.i, q.j) !== T_FLOOR) offFloor++;
        }
      }
    }
    expect(offFloor).toBe(0);
  });

  it("the plaza does not blow the floor's part budget", () => {
    // A plaza is 37x37 to 86x86 where a legacy room is at most 22x22, and the
    // bumper field's count scales with AREA. At the legacy fixed spacing this
    // put every greathall floor at 48-63 parts/1k against a cap of 34.
    //
    // Note the budget is ADDITIVE, not debited: `corridorBudget` is computed as
    // `partBudget + parts.length - circuitPartCount` AFTER rooms have pushed,
    // so the corridor still gets its full deal and room parts land on top.
    // PLAZA_PLAN A-1 claims the opposite; do not trust it, measure.
    const cap = DEFAULT_DENSITY.maxPartsPer1k;
    for (const s of WITH_ROOMS) {
      const per1k = (s.parts.length * 1000) / Math.max(1, s.walkable);
      expect(per1k, `${per1k.toFixed(1)}/1k @ seed ${s.seed} L${s.level}`).toBeLessThanOrEqual(cap);
    }
  });
});
