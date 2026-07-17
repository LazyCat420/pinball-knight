import { describe, it, expect } from "vitest";
import { generateMaze, thickenWalls, mulberry32, at, T_FLOOR, T_WALL } from "./generator";
import { PREFABS, THEMES, ShuffleBag, rotatePrefab, mirrorPrefab, variantsOf, stampPrefabs, fullyReachable, themeFor } from "./prefabs";

describe("prefab stamps", () => {
  it("every stamp preserves full reachability (floor-only carving)", () => {
    for (const theme of THEMES) {
      for (let seed = 1; seed <= 5; seed++) {
        const rng = mulberry32(seed * 7919);
        const g = generateMaze(16, 12, rng);
        stampPrefabs(g, rng, 4, theme);
        expect(fullyReachable(g, 1, 1)).toBe(true);
      }
    }
  });

  it("stamping still holds after thickening", () => {
    const rng = mulberry32(1234);
    const g = generateMaze(18, 13, rng);
    stampPrefabs(g, rng, 3, THEMES[0]);
    const thick = thickenWalls(g);
    expect(fullyReachable(thick, 2, 2)).toBe(true);
  });

  it("anchors land on carved floor, inside bounds", () => {
    const rng = mulberry32(42);
    const g = generateMaze(20, 14, rng);
    const { anchors } = stampPrefabs(g, rng, 4, THEMES[1]);
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) {
      expect(a.i).toBeGreaterThan(0);
      expect(a.j).toBeGreaterThan(0);
      expect(a.i).toBeLessThan(g.w - 1);
      expect(a.j).toBeLessThan(g.h - 1);
      expect(at(g, a.i, a.j)).toBe(T_FLOOR);
    }
  });

  it("rotatePrefab ×4 is the identity", () => {
    for (const p of PREFABS) {
      let r = p;
      for (let k = 0; k < 4; k++) r = rotatePrefab(r);
      expect(r.cells).toEqual(p.cells);
    }
  });

  it("mirrorPrefab ×2 is the identity and preserves footprint", () => {
    for (const p of PREFABS) {
      const m = mirrorPrefab(p);
      expect(m.cells.length).toBe(p.cells.length);
      expect(m.cells[0].length).toBe(p.cells[0].length);
      expect(mirrorPrefab(m).cells).toEqual(p.cells);
    }
  });

  it("variantsOf yields de-duped orientations (1..8)", () => {
    for (const p of PREFABS) {
      const vs = variantsOf(p);
      expect(vs.length).toBeGreaterThanOrEqual(1);
      expect(vs.length).toBeLessThanOrEqual(8);
      const keys = new Set(vs.map((v) => v.cells.join("|")));
      expect(keys.size).toBe(vs.length); // no duplicate orientation in the bag
    }
  });

  it("every theme pool references real prefabs", () => {
    const names = new Set(PREFABS.map((p) => p.name));
    for (const t of THEMES) {
      for (const n of t.pool) expect(names.has(n)).toBe(true);
    }
  });

  it("themeFor cycles through all themes by depth", () => {
    const seen = new Set<string>();
    for (let l = 1; l <= THEMES.length; l++) seen.add(themeFor(l).name);
    expect(seen.size).toBe(THEMES.length);
  });
});

describe("ShuffleBag", () => {
  it("never repeats an item before the bag empties", () => {
    const rng = mulberry32(99);
    const items = ["a", "b", "c", "d", "e"];
    const bag = new ShuffleBag(items, rng);
    for (let round = 0; round < 6; round++) {
      const drawn = new Set<string>();
      for (let k = 0; k < items.length; k++) {
        const d = bag.draw();
        expect(drawn.has(d)).toBe(false); // no repeat inside a cycle
        drawn.add(d);
      }
      expect(drawn.size).toBe(items.length); // every item seen each cycle
    }
  });

  it("is deterministic for a fixed seed", () => {
    const a = new ShuffleBag([1, 2, 3, 4], mulberry32(7));
    const b = new ShuffleBag([1, 2, 3, 4], mulberry32(7));
    for (let k = 0; k < 12; k++) expect(a.draw()).toBe(b.draw());
  });
});

describe("stamp legend sanity", () => {
  it("stamps only use known glyphs and are rectangular", () => {
    const legal = new Set([".", "#", "B", "R", "S", "O", "G", "P", "L", "D", "M", "F", "T", "I", "E", "N", "*", "$"]);
    for (const p of PREFABS) {
      const w = p.cells[0].length;
      for (const row of p.cells) {
        expect(row.length).toBe(w);
        for (const ch of row) expect(legal.has(ch)).toBe(true);
      }
    }
  });

  it("a wall-only grid stays wall outside the stamp footprint", () => {
    // Regression guard: stamping must never ADD walls anywhere.
    const rng = mulberry32(5);
    const g = generateMaze(16, 12, rng);
    const before = new Uint8Array(g.t);
    stampPrefabs(g, rng, 3, THEMES[2]);
    for (let k = 0; k < g.t.length; k++) {
      if (before[k] !== T_WALL) {
        // floor can never revert to wall
        expect(g.t[k]).not.toBe(T_WALL);
      }
    }
  });
});
