/**
 * TRACK SYSTEM tests — the track-first generator.
 *
 * The properties pinned here are the ones that were actually WRONG at some
 * point while building it, each with the measurement that caught it. A test
 * that never failed teaches nothing; these all did.
 *
 *  · The network must be LOOPY and must vary. The first working version was
 *    rank 2 on 30/30 seeds — a perfect figure-eight, identical every floor.
 *  · Reinforcement must beat decay. A scaling error made |Q|^gain ~20x weaker
 *    than μD, so every tube starved to the floor: 42/42 edges at conductivity
 *    0.000, and the "grown" network was uniformly dead.
 *  · Curves must be LARGE. The whole point of track-first is allocating space
 *    instead of scavenging it (shipped generator: radius-4 fillets fitted 4
 *    times in 40 floors).
 *  · The floor must be ONE component. Without an explicit connect pass it was
 *    83 components on one floor and 75/75 test floors fragmented.
 *  · The track must not eat the floor. Uncapped chord length paved up to 97%
 *    of a floor, leaving no maze at all.
 */
import { describe, it, expect } from "vitest";
import { mulberry32 } from "../../../utils/rng";
import { growTrack, circuitRank, seedNodes, meshNeighbours, growNetwork, DEFAULT_GROW } from "./track-grow";
import { buildTrackPath, totalArcLength, TRACK_RADII } from "./track-path";
import { carveTrack, growMazeAround } from "./track-carve";
import { idx, isWalkable, T_FLOOR, type Grid } from "./generator";

const rngFor = (s: number): (() => number) => mulberry32((s * 2654435761) >>> 0);

function blankGrid(w: number, h: number): Grid {
  return { w, h, t: new Uint8Array(w * h), shapes: new Uint8Array(w * h) };
}

/** Build a whole track-first floor the way the generator does. */
function buildTrackFloor(w: number, h: number, seed: number) {
  const rng = rngFor(seed);
  const g = blankGrid(w, h);
  const graph = growTrack(w, h, rng);
  const path = buildTrackPath(graph);
  const mask = carveTrack(g, path);
  growMazeAround(g, mask, rng);
  return { g, graph, path, mask };
}

/** Count 4-connected components of walkable tiles. */
function components(g: Grid): number[] {
  const N = g.w * g.h;
  const seen = new Uint8Array(N);
  const out: number[] = [];
  for (let k0 = 0; k0 < N; k0++) {
    const i0 = k0 % g.w;
    const j0 = (k0 - i0) / g.w;
    if (seen[k0] || !isWalkable(g, i0, j0)) continue;
    const st = [k0];
    seen[k0] = 1;
    let n = 0;
    while (st.length) {
      const k = st.pop()!;
      n++;
      const i = k % g.w;
      const j = (k - i) / g.w;
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const x = i + di;
        const y = j + dj;
        if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
        const kk = idx(g, x, y);
        if (seen[kk] || !isWalkable(g, x, y)) continue;
        seen[kk] = 1;
        st.push(kk);
      }
    }
    out.push(n);
  }
  return out.sort((a, b) => b - a);
}

describe("track growth (Physarum)", () => {
  it("always produces a LOOPY circuit — never a tree", () => {
    for (let s = 0; s < 30; s++) {
      const g = growTrack(70, 50, rngFor(s));
      expect(circuitRank(g), `seed ${s} has no loop`).toBeGreaterThanOrEqual(2);
    }
  });

  it("the topology VARIES between floors", () => {
    // The regression: an early version returned rank exactly 2 on 30/30 seeds,
    // because the pruner shaved to the minLoops floor every time. "Organic and
    // morphing" means the circuit rank itself has to move.
    const ranks = new Set<number>();
    for (let s = 0; s < 30; s++) ranks.add(circuitRank(growTrack(70, 50, rngFor(s))));
    expect(ranks.size, `only ${[...ranks]} seen — topology is fixed`).toBeGreaterThan(2);
  });

  it("reinforcement actually beats decay — the network does not starve", () => {
    // The scaling bug: |Q|^gain was ~20x smaller than μD, so EVERY tube decayed
    // to the 1e-4 floor and the graph carried no information at all.
    const rng = rngFor(7);
    const nodes = seedNodes(70, 50, rng, { foods: 5, relays: 12 });
    const grown = growNetwork({ nodes, edges: meshNeighbours(nodes, 4) }, rng, DEFAULT_GROW);
    const maxD = Math.max(...grown.edges.map((e) => e.d));
    expect(maxD, "every tube starved — reinforcement is too weak").toBeGreaterThan(0.5);
    // And it must SEPARATE: a uniform field is as useless as a dead one.
    const strong = grown.edges.filter((e) => e.d > maxD * 0.5).length;
    expect(strong).toBeGreaterThan(0);
    expect(strong).toBeLessThan(grown.edges.length);
  });

  it("is deterministic for a given seed (co-op peers must agree)", () => {
    const a = growTrack(60, 44, rngFor(11));
    const b = growTrack(60, 44, rngFor(11));
    expect(a.edges.length).toBe(b.edges.length);
    expect(a.edges.map((e) => [e.a, e.b])).toEqual(b.edges.map((e) => [e.a, e.b]));
  });
});

describe("track path (rideable geometry)", () => {
  it("authors LARGE-radius curves, not scavenged fillets", () => {
    // The shipped arc-sweeps scavenger fitted radius 4 exactly 4 times across
    // 40 floors. Allocating space instead of hunting for it should beat that by
    // orders of magnitude.
    let big = 0;
    let arcs = 0;
    for (let s = 0; s < 20; s++) {
      const p = buildTrackPath(growTrack(60, 44, rngFor(s)));
      arcs += p.arcs.length;
      big += p.arcs.filter((a) => a.r >= 5).length;
    }
    expect(arcs).toBeGreaterThan(100);
    expect(big, "no large-radius curves — track-first bought us nothing").toBeGreaterThan(100);
  });

  it("every arc radius stays inside the authored range", () => {
    // Re-deriving R from a shared setback once produced radii up to 2161 tiles
    // on shallow junctions — a straight line pretending to be a curve.
    for (let s = 0; s < 20; s++) {
      for (const a of buildTrackPath(growTrack(60, 44, rngFor(s))).arcs) {
        expect(a.r).toBeGreaterThanOrEqual(1);
        expect(a.r).toBeLessThanOrEqual(TRACK_RADII[0] + 1e-6);
        expect(Number.isFinite(a.span)).toBe(true);
        expect(a.span).toBeGreaterThan(0);
      }
    }
  });

  it("arcs are TANGENT to the legs they join (no floating fragments)", () => {
    // An arc whose endpoints don't meet a leg is exactly the orphaned-curve
    // artefact this rework exists to remove. Sub-tile error is fine — the
    // rasterizer carves a 4-5 tile wide lane over it.
    let checked = 0;
    let bad = 0;
    for (let s = 0; s < 20; s++) {
      const p = buildTrackPath(growTrack(60, 44, rngFor(s)));
      const ends: Array<{ x: number; z: number }> = [];
      for (const l of p.legs) ends.push({ x: l.x0, z: l.z0 }, { x: l.x1, z: l.z1 });
      for (const a of p.arcs) {
        for (const ang of [a.a0, a.a0 + a.span]) {
          const x = a.cx + Math.cos(ang) * a.r;
          const z = a.cz + Math.sin(ang) * a.r;
          let near = Infinity;
          for (const e of ends) near = Math.min(near, Math.hypot(e.x - x, e.z - z));
          checked++;
          if (near > 1.2) bad++;
        }
      }
    }
    expect(checked).toBeGreaterThan(200);
    expect(bad / checked, "too many arcs float free of the track").toBeLessThan(0.06);
  });
});

describe("track carve + maze growth", () => {
  it("EVERY floor is a single connected component", () => {
    // The invariant a player's run depends on. Without the explicit connect
    // pass this was 83 components on one floor, 75/75 floors fragmented.
    for (const [w, h] of [
      [48, 32],
      [70, 44],
      [96, 54],
    ] as const) {
      for (let s = 0; s < 12; s++) {
        const { g } = buildTrackFloor(w, h, s + 1);
        const comps = components(g);
        expect(comps.length, `${w}x${h} seed ${s}: ${comps.length} components`).toBe(1);
      }
    }
  });

  it("the track never eats the whole floor", () => {
    // Uncapped chord length paved up to 97% of a floor, leaving no maze.
    for (let s = 0; s < 20; s++) {
      const { g, mask } = buildTrackFloor(96, 54, s + 1);
      let lane = 0;
      let floor = 0;
      for (let k = 0; k < g.w * g.h; k++) {
        if (mask.lane[k]) lane++;
        if (g.t[k] === T_FLOOR) floor++;
      }
      expect(floor).toBeGreaterThan(0);
      const pct = lane / floor;
      expect(pct, `seed ${s}: track is ${(pct * 100) | 0}% of floor`).toBeLessThan(0.8);
      expect(pct, `seed ${s}: barely any track`).toBeGreaterThan(0.1);
    }
  });

  it("carves a lane wide enough to ride", () => {
    // A one-tile "track" is a corridor. The whole design needs a ball to be
    // able to take a line, so the lane must be genuinely wide.
    const { g, mask } = buildTrackFloor(80, 50, 5);
    let widest = 0;
    for (let j = 0; j < g.h; j++) {
      let run = 0;
      for (let i = 0; i < g.w; i++) {
        run = mask.lane[idx(g, i, j)] ? run + 1 : 0;
        widest = Math.max(widest, run);
      }
    }
    expect(widest).toBeGreaterThanOrEqual(4);
  });

  it("is deterministic end-to-end", () => {
    const a = buildTrackFloor(70, 44, 3);
    const b = buildTrackFloor(70, 44, 3);
    expect(Array.from(a.g.t)).toEqual(Array.from(b.g.t));
  });
});
