import { describe, it, expect } from "vitest";
import { generateMaze, thickenWalls, mulberry32, at, T_FLOOR, T_WALL } from "./generator";
import { PREFABS, LANDMARKS, THEMES, ShuffleBag, rotatePrefab, mirrorPrefab, variantsOf, stampPrefabs, stampLandmark, pickFocusCells, fullyReachable, themeFor } from "./prefabs";

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

describe("stamp variety", () => {
  it("does not repeat a room until the theme's pool is exhausted", () => {
    // Regression: the shuffle bag used to hold ORIENTATIONS, so its no-repeat
    // guarantee was per-variant — a floor could land four rotations of the
    // Switchback and read as the same room four times over.
    for (const theme of THEMES) {
      for (let seed = 1; seed <= 12; seed++) {
        const rng = mulberry32(seed * 8191);
        const g = generateMaze(30, 22, rng);
        const { stamped } = stampPrefabs(g, rng, 5, theme, [], pickFocusCells(g, rng));
        // Inside the first pool-many placements every name must be distinct.
        const firstCycle = stamped.slice(0, Math.min(stamped.length, theme.pool.length));
        expect(new Set(firstCycle).size, `${theme.name} seed ${seed}: ${stamped.join(",")}`).toBe(firstCycle.length);
      }
    }
  });

  it("a floor with room for many stamps still shows several distinct rooms", () => {
    let totalDistinct = 0;
    const runs = 10;
    for (let seed = 1; seed <= runs; seed++) {
      const rng = mulberry32(seed * 2749);
      const g = generateMaze(32, 24, rng);
      const { stamped } = stampPrefabs(g, rng, 6, THEMES[2], [], pickFocusCells(g, rng));
      totalDistinct += new Set(stamped).size;
    }
    expect(totalDistinct / runs).toBeGreaterThanOrEqual(3);
  });
});

describe("landmark set pieces", () => {
  it("every theme can draw a landmark, and every name resolves", () => {
    const names = new Set(LANDMARKS.map((p) => p.name));
    for (const t of THEMES) {
      expect(t.landmarks.length, `${t.name} has no landmark`).toBeGreaterThan(0);
      for (const n of t.landmarks) expect(names.has(n), `${t.name} → ${n}`).toBe(true);
    }
  });

  it("landmarks are big enough to read as set pieces", () => {
    // The whole point of the tier: bigger than the 3-7 cell furniture stamps.
    for (const p of LANDMARKS) {
      expect(Math.max(p.cells.length, p.cells[0].length), p.name).toBeGreaterThanOrEqual(7);
    }
  });

  it("landmarks are rectangular and use only legal glyphs", () => {
    const legal = new Set([".", "#", "B", "R", "S", "O", "G", "P", "L", "D", "M", "F", "T", "I", "E", "N", "*", "$"]);
    for (const p of LANDMARKS) {
      const w = p.cells[0].length;
      for (const row of p.cells) {
        expect(row.length, `${p.name} ragged`).toBe(w);
        for (const ch of row) expect(legal.has(ch), `${p.name}: '${ch}'`).toBe(true);
      }
    }
  });

  it("places exactly one landmark and keeps the floor solvable", () => {
    for (const theme of THEMES) {
      for (let seed = 1; seed <= 5; seed++) {
        const rng = mulberry32(seed * 6151);
        const g = generateMaze(24, 18, rng);
        const res = stampLandmark(g, rng, theme);
        expect(res.stamped.length, `${theme.name} seed ${seed}`).toBe(1);
        expect(theme.landmarks).toContain(res.stamped[0]);
        expect(fullyReachable(g, 1, 1)).toBe(true);
      }
    }
  });

  it("landmark anchors land on carved floor", () => {
    const rng = mulberry32(4242);
    const g = generateMaze(26, 20, rng);
    const { anchors } = stampLandmark(g, rng, THEMES[0]);
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) expect(at(g, a.i, a.j)).toBe(T_FLOOR);
  });

  it("regular stamps never overlap the landmark's claim", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const rng = mulberry32(seed * 991);
      const g = generateMaze(26, 20, rng);
      const lm = stampLandmark(g, rng, THEMES[3]);
      const after = stampPrefabs(g, rng, 5, THEMES[3], lm.claimed, pickFocusCells(g, rng));
      const [claim] = lm.claimed;
      for (const r of after.claimed.slice(1)) {
        const overlap = r.cx < claim.cx + claim.w && claim.cx < r.cx + r.w && r.cy < claim.cy + claim.h && claim.cy < r.cy + r.h;
        expect(overlap, `seed ${seed}`).toBe(false);
      }
      expect(fullyReachable(g, 1, 1)).toBe(true);
    }
  });

  it("the full stamp pass survives thickening", () => {
    for (const theme of THEMES) {
      const rng = mulberry32(7777);
      const g = generateMaze(28, 21, rng);
      const lm = stampLandmark(g, rng, theme);
      stampPrefabs(g, rng, 6, theme, lm.claimed, pickFocusCells(g, rng));
      expect(fullyReachable(thickenWalls(g), 2, 2), theme.name).toBe(true);
    }
  });
});

describe("hot zones", () => {
  it("picks spaced focal cells inside the lattice", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const rng = mulberry32(seed * 313);
      const g = generateMaze(24, 18, rng);
      const focus = pickFocusCells(g, rng);
      expect(focus.length).toBeGreaterThan(0);
      for (const [cx, cy] of focus) {
        expect(cx).toBeGreaterThanOrEqual(0);
        expect(cy).toBeGreaterThanOrEqual(0);
        expect(cx).toBeLessThan((g.w - 1) / 2);
        expect(cy).toBeLessThan((g.h - 1) / 2);
      }
    }
  });

  it("clusters stamps tighter than a uniform sprinkle does", () => {
    // The pacing goal: loud arenas AND quiet halls, not an even mush. Measured
    // as mean pairwise distance between stamp footprints, averaged over seeds.
    const spread = (useFocus: boolean): number => {
      const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
      let total = 0;
      let runs = 0;
      for (const s of seeds) {
        const rng = mulberry32(s * 5077);
        const g = generateMaze(30, 22, rng);
        const focus = useFocus ? pickFocusCells(g, rng) : [];
        const { claimed } = stampPrefabs(g, rng, 6, THEMES[0], [], focus);
        if (claimed.length < 2) continue;
        let sum = 0;
        let pairs = 0;
        for (let a = 0; a < claimed.length; a++) {
          for (let b = a + 1; b < claimed.length; b++) {
            sum += Math.hypot(claimed[a].cx - claimed[b].cx, claimed[a].cy - claimed[b].cy);
            pairs++;
          }
        }
        total += sum / pairs;
        runs++;
      }
      return total / runs;
    };
    expect(spread(true)).toBeLessThan(spread(false));
  });

  it("focus biasing never breaks reachability", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const rng = mulberry32(seed * 60077);
      const g = generateMaze(26, 19, rng);
      stampPrefabs(g, rng, 6, THEMES[1], [], pickFocusCells(g, rng));
      expect(fullyReachable(g, 1, 1)).toBe(true);
    }
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
