import { describe, it, expect } from "vitest";
import { generateMaze, thickenWalls, mulberry32, at, idx, T_FLOOR, T_WALL } from "./generator";
import { ARCHETYPES, archetypeFor, windinessFor } from "./archetypes";
import { bfsDistances } from "../engine/flow-field";

/** Every floor tile reachable from the first walkable tile — the core invariant. */
function assertSolvable(g: ReturnType<typeof generateMaze>, label: string): void {
  let si = -1;
  let sj = -1;
  outer: for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      if (at(g, i, j) === T_FLOOR) {
        si = i;
        sj = j;
        break outer;
      }
    }
  }
  expect(si, `${label}: no floor at all`).toBeGreaterThanOrEqual(0);
  const dist = bfsDistances(g, si, sj);
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      if (at(g, i, j) === T_FLOOR) {
        expect(dist[idx(g, i, j)], `${label}: tile ${i},${j} stranded`).toBeGreaterThanOrEqual(0);
      }
    }
  }
}

const SIZES: Array<[number, number]> = [
  [18, 13], // level 1-ish
  [33, 25], // the deep-floor cap
  [8, 6], // small, to catch clamp/edge bugs
];

describe("floor archetypes", () => {
  it("every archetype produces a fully solvable floor at every size", () => {
    for (const arch of ARCHETYPES) {
      for (const [cw, ch] of SIZES) {
        for (const seed of [1, 7, 42, 1234, 99991]) {
          const rng = mulberry32(seed);
          const seeds = arch.seeds(cw, ch, rng) ?? undefined;
          const g = generateMaze(cw, ch, rng, 0.2 * arch.braidMult, 1, { seeds, solidSeeds: arch.solid, braidGradient: arch.braidGradient });
          assertSolvable(g, `${arch.id} ${cw}x${ch} seed ${seed}`);
        }
      }
    }
  });

  it("stays solvable after thickening (what the game actually plays on)", () => {
    for (const arch of ARCHETYPES) {
      for (const seed of [3, 88, 2024]) {
        const rng = mulberry32(seed);
        const seeds = arch.seeds(24, 18, rng) ?? undefined;
        const g = thickenWalls(generateMaze(24, 18, rng, 0.18, 1, { seeds, solidSeeds: arch.solid, braidGradient: arch.braidGradient }));
        assertSolvable(g, `${arch.id} thick seed ${seed}`);
      }
    }
  });

  it("keeps the border solid — a seeded shape never breaches the edge", () => {
    for (const arch of ARCHETYPES) {
      for (const seed of [5, 61]) {
        const rng = mulberry32(seed);
        const seeds = arch.seeds(20, 15, rng) ?? undefined;
        // With solidSeeds ON: the corner-pillar carve writes to even/even tiles,
        // which is exactly the write most likely to reach past the edge.
        const g = generateMaze(20, 15, rng, 0.2, 1, { seeds, solidSeeds: true });
        for (let i = 0; i < g.w; i++) {
          expect(at(g, i, 0), `${arch.id} top`).toBe(T_WALL);
          expect(at(g, i, g.h - 1), `${arch.id} bottom`).toBe(T_WALL);
        }
        for (let j = 0; j < g.h; j++) {
          expect(at(g, 0, j), `${arch.id} left`).toBe(T_WALL);
          expect(at(g, g.w - 1, j), `${arch.id} right`).toBe(T_WALL);
        }
      }
    }
  });

  it("seed cells stay inside the cell lattice", () => {
    for (const arch of ARCHETYPES) {
      for (const seed of [2, 33, 404]) {
        const cells = arch.seeds(22, 16, mulberry32(seed));
        if (!cells) continue;
        for (const [cx, cy] of cells) {
          expect(Number.isInteger(cx), `${arch.id} non-integer cx`).toBe(true);
          expect(Number.isInteger(cy), `${arch.id} non-integer cy`).toBe(true);
          expect(cx).toBeGreaterThanOrEqual(0);
          expect(cy).toBeGreaterThanOrEqual(0);
          expect(cx).toBeLessThan(22);
          expect(cy).toBeLessThan(16);
        }
      }
    }
  });

  it("is deterministic: same seed, same floor", () => {
    for (const arch of ARCHETYPES) {
      const build = (): number[] => {
        const rng = mulberry32(777);
        const seeds = arch.seeds(20, 15, rng) ?? undefined;
        return Array.from(generateMaze(20, 15, rng, 0.2, 1, { seeds, solidSeeds: arch.solid, braidGradient: arch.braidGradient }).t);
      };
      expect(build(), arch.id).toEqual(build());
    }
  });

  it("the shaped archetypes are measurably more open than plain warrens", () => {
    // The whole point of the Great Hall is open area to carom in. Averaged over
    // seeds so it isn't a coin flip.
    const openness = (id: string): number => {
      const arch = ARCHETYPES.find((a) => a.id === id)!;
      const seeds = [1, 2, 3, 4, 5];
      return (
        seeds.reduce((sum, s) => {
          const rng = mulberry32(s * 131);
          const cells = arch.seeds(24, 18, rng) ?? undefined;
          const g = generateMaze(24, 18, rng, 0.15, 1, { seeds: cells, solidSeeds: arch.solid });
          let floors = 0;
          for (let k = 0; k < g.t.length; k++) if (g.t[k] === T_FLOOR) floors++;
          return sum + floors / g.t.length;
        }, 0) / seeds.length
      );
    };
    expect(openness("greathall")).toBeGreaterThan(openness("warrens"));
  });

  it("archetypeFor cycles every archetype and opens on warrens", () => {
    expect(archetypeFor(1).id).toBe("warrens");
    const seen = new Set<string>();
    for (let l = 1; l <= ARCHETYPES.length; l++) seen.add(archetypeFor(l).id);
    expect(seen.size).toBe(ARCHETYPES.length);
    // Cycles cleanly past the end.
    expect(archetypeFor(ARCHETYPES.length + 1).id).toBe(archetypeFor(1).id);
  });

  it("archetype and biome pairings take 20 floors to repeat", () => {
    // 5 archetypes × 4 biomes: the pair should not repeat inside 20 floors.
    const pairs = new Set<string>();
    for (let l = 1; l <= 20; l++) pairs.add(`${archetypeFor(l).id}|${(l - 1) % 4}`);
    expect(pairs.size).toBe(20);
  });
});

describe("seeded generateMaze", () => {
  it("an absent seeds option is bit-identical to the plain backtracker", () => {
    // The default path must not shift the rng stream, or every existing floor
    // (spawns, torches, loot) would reroll.
    for (const seed of [3, 88, 2024]) {
      const a = generateMaze(11, 8, mulberry32(seed));
      const b = generateMaze(11, 8, mulberry32(seed), 0.12, 1, {});
      expect(Array.from(b.t)).toEqual(Array.from(a.t));
    }
  });

  it("braidGradient=0 is bit-identical to no gradient at all", () => {
    for (const seed of [9, 404]) {
      const a = generateMaze(12, 9, mulberry32(seed), 0.2, 1);
      const b = generateMaze(12, 9, mulberry32(seed), 0.2, 1, { braidGradient: 0 });
      expect(Array.from(b.t)).toEqual(Array.from(a.t));
    }
  });

  it("stitches DISCONNECTED seed groups into one floor", () => {
    // Two seed blobs in opposite corners with nothing between them: without the
    // stitch pass each grows its own tree and the floor splits in two.
    const seeds: Array<readonly [number, number]> = [
      [1, 1], [2, 1], [1, 2], [2, 2],
      [18, 12], [19, 12], [18, 13], [19, 13],
    ];
    for (const seed of [1, 2, 3]) {
      const g = generateMaze(22, 16, mulberry32(seed), 0, 1, { seeds });
      assertSolvable(g, `two-blob seed ${seed}`);
    }
  });

  it("carves the seeded cells it was given", () => {
    const seeds: Array<readonly [number, number]> = [[4, 4], [5, 4], [6, 4]];
    const g = generateMaze(14, 10, mulberry32(11), 0, 1, { seeds });
    for (const [cx, cy] of seeds) expect(at(g, cx * 2 + 1, cy * 2 + 1)).toBe(T_FLOOR);
    // …and welded them: the walls between adjacent seeds are open.
    expect(at(g, 4 * 2 + 2, 4 * 2 + 1)).toBe(T_FLOOR);
    expect(at(g, 5 * 2 + 2, 4 * 2 + 1)).toBe(T_FLOOR);
  });

  it("solidSeeds fills a seeded rect completely — no leftover corner pillars", () => {
    // Regression: welding adjacent seeds opens the walls BETWEEN cells but
    // leaves the even/even corner tile standing, so a "great hall" came out as
    // a hypostyle hall — a 2×2 column every four tiles after thickening, which
    // is useless as the open arena the archetype exists to provide.
    const rect: Array<readonly [number, number]> = [];
    for (let y = 3; y <= 9; y++) for (let x = 3; x <= 11; x++) rect.push([x, y] as const);

    const solid = generateMaze(18, 14, mulberry32(21), 0, 1, { seeds: rect, solidSeeds: true });
    for (let cy = 3; cy < 9; cy++) {
      for (let cx = 3; cx < 11; cx++) {
        expect(at(solid, cx * 2 + 2, cy * 2 + 2), `pillar left at cell ${cx},${cy}`).toBe(T_FLOOR);
      }
    }
    // Every tile of the rect's interior span is floor.
    for (let j = 3 * 2 + 1; j <= 9 * 2 + 1; j++) {
      for (let i = 3 * 2 + 1; i <= 11 * 2 + 1; i++) {
        expect(at(solid, i, j), `hole at ${i},${j}`).toBe(T_FLOOR);
      }
    }
    // …and OFF, the pillars are still there, so the flag is what does it.
    const pillared = generateMaze(18, 14, mulberry32(21), 0, 1, { seeds: rect });
    let pillars = 0;
    for (let cy = 3; cy < 9; cy++) {
      for (let cx = 3; cx < 11; cx++) if (at(pillared, cx * 2 + 2, cy * 2 + 2) === T_WALL) pillars++;
    }
    expect(pillars).toBeGreaterThan(0);
  });

  it("out-of-range seeds are ignored, not crashed on", () => {
    const g = generateMaze(10, 8, mulberry32(5), 0.1, 1, { seeds: [[-3, 2], [99, 99], [4, 4]] });
    assertSolvable(g, "out-of-range seeds");
  });

  it("an all-out-of-range seed set falls back to the classic start", () => {
    const g = generateMaze(10, 8, mulberry32(5), 0.1, 1, { seeds: [[-1, -1], [50, 50]] });
    expect(at(g, 1, 1)).toBe(T_FLOOR);
    assertSolvable(g, "fallback");
  });

  it("braidGradient opens more loops near the start than at the far corner", () => {
    // The gradient's whole purpose: flankable near spawn, tight near the stairs.
    const halves = (grad: number, seed: number): [number, number] => {
      const g = generateMaze(24, 18, mulberry32(seed), 0.3, 1, { braidGradient: grad });
      let near = 0;
      let far = 0;
      const mid = (g.w + g.h) / 2;
      for (let j = 1; j < g.h - 1; j++) {
        for (let i = 1; i < g.w - 1; i++) {
          // Count carved WALL-slot tiles (even/even lattice positions are the
          // only ones braid can open).
          if (i % 2 === 0 && j % 2 === 1 && at(g, i, j) === T_FLOOR) {
            if (i + j < mid) near++;
            else far++;
          }
        }
      }
      return [near, far];
    };
    const seeds = [1, 2, 3, 4, 5, 6];
    let nearTotal = 0;
    let farTotal = 0;
    for (const s of seeds) {
      const [n, f] = halves(0.8, s);
      nearTotal += n;
      farTotal += f;
    }
    // Normalised by area the near half is the smaller triangle, so compare
    // against the flat case rather than each other.
    let flatNear = 0;
    let flatFar = 0;
    for (const s of seeds) {
      const [n, f] = halves(0, s);
      flatNear += n;
      flatFar += f;
    }
    expect(nearTotal / farTotal).toBeGreaterThan(flatNear / flatFar);
  });
});

describe("windinessFor", () => {
  it("pins level 1 to the winding backtracker floor players know", () => {
    expect(windinessFor(1, archetypeFor(1), mulberry32(1))).toBe(1);
  });

  it("rolls inside the archetype's own range on every deeper floor", () => {
    for (const arch of ARCHETYPES) {
      const [lo, hi] = arch.windiness;
      expect(lo).toBeGreaterThanOrEqual(0);
      expect(hi).toBeLessThanOrEqual(1);
      expect(hi).toBeGreaterThan(lo); // a POINT value would be the old fixed cycle again
      for (let seed = 0; seed < 40; seed++) {
        const w = windinessFor(5, arch, mulberry32(seed));
        expect(w, `${arch.id} seed ${seed}`).toBeGreaterThanOrEqual(lo);
        expect(w).toBeLessThanOrEqual(hi);
      }
    }
  });

  it("gives two floors of the SAME archetype different corridor texture", () => {
    // The whole point: a flat depth cycle made every Cavern identical in shape.
    const arch = ARCHETYPES.find((a) => a.id === "cavern")!;
    const a = windinessFor(9, arch, mulberry32(3));
    const b = windinessFor(29, arch, mulberry32(17));
    expect(Math.abs(a - b)).toBeGreaterThan(0.01);
  });

  it("keeps each archetype's texture in character with its macro shape", () => {
    const by = (id: string) => ARCHETYPES.find((a) => a.id === id)!.windiness;
    // A spine's branches must stay dead-endy or the highway loses its monopoly.
    expect(by("spine")[0]).toBeGreaterThan(by("greathall")[1]);
    // A cavern is short and branchy; a hall wants a bushy rind. Both low.
    expect(by("cavern")[1]).toBeLessThan(by("warrens")[0]);
  });
});
