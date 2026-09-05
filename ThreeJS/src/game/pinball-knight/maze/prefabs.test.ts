import { describe, it, expect } from "vitest";
import { generateMaze, thickenWalls, mulberry32, at, T_FLOOR, T_WALL } from "./generator";
import { PREFABS, LANDMARKS, THEMES, CYCLE_FLOORS, ShuffleBag, rotatePrefab, mirrorPrefab, variantsOf, stampPrefabs, stampLandmark, pickFocusCells, fullyReachable, themeFor, themeIndexFor, passFor, bandFloorFor } from "./prefabs";

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

  it("themeFor reaches every theme inside one pass of the schedule", () => {
    // Set equality BOTH WAYS against the table, not a count: an allowlist can
    // drift in both directions at once and keep its length. Two missing themes
    // and two invented ones would satisfy `seen.size === THEMES.length`.
    const seen = new Set<string>();
    for (let l = 1; l <= CYCLE_FLOORS; l++) seen.add(themeFor(l).name);
    const declared = new Set(THEMES.map((t) => t.name));
    for (const n of declared) expect(seen.has(n), `${n} is declared but no depth produces it`).toBe(true);
    for (const n of seen) expect(declared.has(n), `depth produced ${n}, which is not a theme`).toBe(true);
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

/**
 * THE BAND SCHEDULE. It used to be a per-run permutation of four themes, which
 * meant a floor's biome could not be known before you stood in it — while the
 * depth-select screen printed a fixed five-band schedule to the player anyway.
 *
 * These pin the replacement, and they check the SCHEDULE'S SHAPE rather than
 * re-listing the numbers: a test that says "band 2 starts at 6" beside a table
 * that says `from: 6` is one transcription checked against another.
 */
describe("the band schedule", () => {
  const starts = THEMES.map((t) => t.from);

  it("is a well-formed contiguous schedule that fills exactly one cycle", () => {
    expect(starts[0], "the first band must start at floor 1").toBe(1);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i], `band ${i} starts at or before band ${i - 1}`).toBeGreaterThan(starts[i - 1]);
    }
    // Every band the same length, INCLUDING the last — the wrap happens at
    // CYCLE_FLOORS, so a short or long final band puts the repeat mid-band and
    // hands floor CYCLE_FLOORS+1 the wrong biome.
    const spans = starts.map((s, i) => (i + 1 < starts.length ? starts[i + 1] : CYCLE_FLOORS + 1) - s);
    for (const [i, span] of spans.entries()) {
      expect(span, `band ${i} (${THEMES[i].name}) spans ${span} floors, not ${spans[0]}`).toBe(spans[0]);
    }
  });

  it("gives every floor of a band that band's theme, and nothing else", () => {
    for (const [i, theme] of THEMES.entries()) {
      const end = (i + 1 < THEMES.length ? THEMES[i + 1].from : CYCLE_FLOORS + 1) - 1;
      for (let l = theme.from; l <= end; l++) {
        expect(themeIndexFor(l), `floor ${l} should be band ${i} (${theme.name})`).toBe(i);
      }
    }
  });

  it("is 1-based within the band, for the screen's level suffix", () => {
    for (const [i, theme] of THEMES.entries()) {
      const end = (i + 1 < THEMES.length ? THEMES[i + 1].from : CYCLE_FLOORS + 1) - 1;
      expect(bandFloorFor(theme.from), `${theme.name} starts at its own level 1`).toBe(1);
      expect(bandFloorFor(end), `${theme.name} ends at level ${end - theme.from + 1}`).toBe(end - theme.from + 1);
    }
  });

  it("repeats after a full cycle instead of sticking on the deepest band", () => {
    // The bug this replaces: "21+ magma" made every floor past 20 the same
    // place with the same guardian, forever.
    for (let l = 1; l <= CYCLE_FLOORS * 2; l++) {
      expect(themeIndexFor(l + CYCLE_FLOORS), `floor ${l + CYCLE_FLOORS} vs ${l}`).toBe(themeIndexFor(l));
    }
    expect(themeIndexFor(CYCLE_FLOORS + 1), "the cycle restarts at the first band").toBe(0);
  });

  it("counts the passes, so a repeated band can hand over a different guardian", () => {
    expect(passFor(1)).toBe(0);
    expect(passFor(CYCLE_FLOORS)).toBe(0);
    expect(passFor(CYCLE_FLOORS + 1)).toBe(1);
    expect(passFor(CYCLE_FLOORS * 2 + 1)).toBe(2);
  });

  it("clamps depths below 1 rather than indexing off the front of the table", () => {
    for (const l of [0, -1, -99]) {
      expect(themeIndexFor(l)).toBe(0);
      expect(passFor(l)).toBe(0);
      expect(bandFloorFor(l)).toBe(1);
    }
  });
});

describe("pickFocusCells weighting", () => {
  it("makes the first zone dominant and every later zone weaker", () => {
    const g = generateMaze(24, 20, mulberry32(5));
    const focus = pickFocusCells(g, mulberry32(9), 3);
    expect(focus.length).toBeGreaterThan(1);
    expect(focus[0][2]).toBe(1); // dominant
    for (const f of focus.slice(1)) {
      expect(f[2]).toBeGreaterThan(1); // inflated distances → loses candidates
      expect(f[2]).toBeLessThanOrEqual(2.5);
    }
  });

  it("still keeps the zones apart", () => {
    const g = generateMaze(24, 20, mulberry32(5));
    const focus = pickFocusCells(g, mulberry32(9), 3);
    const minSep = Math.max((g.w - 1) / 2, (g.h - 1) / 2) * 0.35;
    for (let a = 0; a < focus.length; a++) {
      for (let b = a + 1; b < focus.length; b++) {
        expect(Math.hypot(focus[a][0] - focus[b][0], focus[a][1] - focus[b][1])).toBeGreaterThanOrEqual(minSep);
      }
    }
  });
});
