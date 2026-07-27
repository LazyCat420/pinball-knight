/**
 * THE FLOOR GATE — the fast constraint pass every generated floor must survive.
 *
 * `floor-pipeline.test.ts` is the deep integration test and it is slow (BFS
 * reachability over dozens of floors in one `it`, which is why vitest.config.js
 * raises testTimeout to 30s). It also mirrors the LEGACY branch of
 * `startLevel` — the one `TRACK_FIRST` switched off — so it has been green
 * while testing a code path that does not ship. That is the shape of bug this
 * file exists to make impossible: it runs the LIVE generator, across every
 * archetype and a spread of depths, and asserts the constraints from
 * `.agents/game-dev-rules/procedural-level-generation.md` §4.
 *
 * Two rules for editing it:
 *  - Assert the CONSTRAINT, not the current output. A test pinned to today's
 *    numbers goes red on every legitimate tuning pass and gets deleted.
 *  - When something fails, the message must carry the seed and the metrics.
 *    A generator failure you cannot reproduce is a generator failure you cannot
 *    fix.
 */
import { describe, it, expect } from "vitest";
import { mulberry32 } from "./generator";
import { buildTrackFloor, floorCircuitRank } from "./track-floor";
import {
  ARCHETYPES,
  archetypeFor,
  windinessFor,
  DEFAULT_TRACK_PROFILE,
  trackNodeCounts,
} from "./archetypes";
import { measureFloor, checkFloor, formatMetrics, traceRoute } from "./floor-metrics";
import { levelConfig } from "../constants";
import { bfsDistances } from "../engine/flow-field";

/** Build a floor exactly the way core.ts startLevel does. */
function liveFloor(level: number, seed: number) {
  const cfg = levelConfig(level);
  const arch = archetypeFor(level);
  const rng = mulberry32((seed ^ (level * 0x9e3779b9)) >>> 0);
  const windiness = windinessFor(level, arch, rng);
  const f = buildTrackFloor(cfg.cellsW, cfg.cellsH, rng, {
    profile: arch.track,
    density: Math.max(0.35, Math.min(0.85, windiness)),
  });
  return { f, arch, cfg };
}

/** Same, but forcing a specific archetype onto a depth. */
function archFloor(archIndex: number, level: number, seed: number) {
  const cfg = levelConfig(level);
  const arch = ARCHETYPES[archIndex];
  const rng = mulberry32((seed ^ (level * 0x9e3779b9)) >>> 0);
  const windiness = windinessFor(level, arch, rng);
  return {
    arch,
    f: buildTrackFloor(cfg.cellsW, cfg.cellsH, rng, {
      profile: arch.track,
      density: Math.max(0.35, Math.min(0.85, windiness)),
    }),
  };
}

describe("floor gate — every generated floor is legal", () => {
  it("the live depth sequence satisfies every constraint", () => {
    const failures: string[] = [];
    for (let level = 1; level <= 12; level++) {
      for (let s = 0; s < 4; s++) {
        const seed = 0x51a7 + s * 7919;
        const { f, arch } = liveFloor(level, seed);
        if (!f) {
          failures.push(`L${level} seed=${seed} ${arch.id}: generator returned null`);
          continue;
        }
        const m = measureFloor(f.grid, f.start, f.stairs, f.mask);
        for (const bad of checkFloor(m, f.grid)) {
          failures.push(`L${level} seed=${seed} ${arch.id}: ${bad}\n    ${formatMetrics(m)}`);
        }
      }
    }
    expect(failures.join("\n")).toBe("");
  });

  it("every archetype is legal at every depth it can appear at", () => {
    const failures: string[] = [];
    for (let a = 0; a < ARCHETYPES.length; a++) {
      for (const level of [1, 5, 11, 20]) {
        for (let s = 0; s < 3; s++) {
          const seed = 0xbead + s * 104729;
          const { f, arch } = archFloor(a, level, seed);
          if (!f) {
            failures.push(`${arch.id} L${level} seed=${seed}: generator returned null`);
            continue;
          }
          const m = measureFloor(f.grid, f.start, f.stairs, f.mask);
          for (const bad of checkFloor(m, f.grid)) {
            failures.push(`${arch.id} L${level} seed=${seed}: ${bad}\n    ${formatMetrics(m)}`);
          }
        }
      }
    }
    expect(failures.join("\n")).toBe("");
  });

  it("the stairs are always reachable and always ON the walkable surface", () => {
    for (let level = 1; level <= 8; level++) {
      const { f } = liveFloor(level, 0x9911);
      expect(f).not.toBeNull();
      const dist = bfsDistances(f!.grid, f!.start.i, f!.start.j);
      const route = traceRoute(f!.grid, f!.start, f!.stairs, dist);
      // A traced route that reaches the spawn is proof the field is walkable
      // end to end — a distance value alone can be inherited across a diagonal.
      expect(route.length).toBeGreaterThan(1);
      expect(route[0]).toEqual({ i: f!.start.i, j: f!.start.j });
      expect(route[route.length - 1]).toEqual({ i: f!.stairs.i, j: f!.stairs.j });
    }
  });
});

describe("archetypes are distinguishable — the acceptance test for a variety feature", () => {
  /**
   * If a census cannot tell the archetypes apart, neither can the player. This
   * is the test that would have caught the five archetypes shaping a grid the
   * live path threw away: before the profiles it failed on every pair, because
   * `buildTrackFloor` took no archetype at all.
   *
   * Deliberately loose. It asserts each archetype's SIGNATURE — the property
   * its name and flavour text promise — not a numeric range, so the profiles
   * can be retuned without rewriting the test.
   */
  function signature(archIndex: number, level: number, seeds = 6) {
    let lane = 0;
    let rank = 0;
    let open = 0;
    let n = 0;
    for (let s = 0; s < seeds; s++) {
      const { f } = archFloor(archIndex, level, 0xc0ffee + s * 7919);
      if (!f) continue;
      const m = measureFloor(f.grid, f.start, f.stairs, f.mask);
      lane += m.laneShare;
      open += m.openShare;
      rank += floorCircuitRank(f);
      n++;
    }
    return { lane: lane / n, rank: rank / n, open: open / n, n };
  }

  const ID = Object.fromEntries(ARCHETYPES.map((a, i) => [a.id, i])) as Record<string, number>;

  it("the Cavern is loopier than the Spine — the flavour text is a topology claim", () => {
    for (const level of [4, 12]) {
      const cavern = signature(ID.cavern, level);
      const spine = signature(ID.spine, level);
      expect(cavern.n).toBeGreaterThan(0);
      // "no straight lines · the rock decides" vs "one long road": the Cavern
      // must carry several times the independent loops.
      expect(cavern.rank).toBeGreaterThan(spine.rank * 2);
    }
  });

  it("the Great Hall is the most open floor and the Warrens the least", () => {
    for (const level of [4, 12]) {
      const hall = signature(ID.greathall, level);
      const warrens = signature(ID.warrens, level);
      // The Hall's roads are wide and its plaza is a chamber; the Warrens is a
      // maze that happens to have roads. Compare LANE share rather than open
      // share — a dense maze opens plenty of tiles, just not as track.
      expect(hall.lane).toBeGreaterThan(warrens.lane * 1.4);
    }
  });

  it("no two archetypes produce the same floor", () => {
    // The blind test: gather each archetype's (lane, rank) signature at one
    // depth and require that no pair sits on top of another. Before the track
    // profiles every pair was identical to three decimal places.
    const sigs = ARCHETYPES.map((a, i) => ({ id: a.id, ...signature(i, 8) }));
    for (let i = 0; i < sigs.length; i++) {
      for (let j = i + 1; j < sigs.length; j++) {
        const dLane = Math.abs(sigs[i].lane - sigs[j].lane);
        const dRank = Math.abs(sigs[i].rank - sigs[j].rank);
        expect(
          dLane > 0.04 || dRank > 1.5,
          `${sigs[i].id} and ${sigs[j].id} are the same floor: lane ${sigs[i].lane.toFixed(3)}/${sigs[j].lane.toFixed(3)}, rank ${sigs[i].rank.toFixed(1)}/${sigs[j].rank.toFixed(1)}`,
        ).toBe(true);
      }
    }
  });
});

describe("the network scales with the floor", () => {
  it("node counts grow with area instead of clamping from floor 1", () => {
    // The regression that motivated the density rewrite: `min(15, area/260+4)`
    // bound at EVERY depth, so a floor three times the area got the same
    // circuit. Assert growth, not absolute values.
    const small = trackNodeCounts(DEFAULT_TRACK_PROFILE, 75, 53);
    const large = trackNodeCounts(DEFAULT_TRACK_PROFILE, 133, 101);
    expect(large.foods).toBeGreaterThan(small.foods * 1.8);
    expect(large.relays).toBeGreaterThan(small.relays * 1.8);
  });

  it("the circuit keeps a real share of the floor at depth", () => {
    // The symptom the clamp produced: lane share decaying 0.30 → 0.12 as floors
    // grew. A deep floor must still be a circuit and not a maze with a scrap of
    // road in it.
    for (const level of [1, 10, 20]) {
      let lane = 0;
      let n = 0;
      for (let s = 0; s < 4; s++) {
        const { f } = liveFloor(level, 0x1234 + s * 7919);
        if (!f) continue;
        lane += measureFloor(f.grid, f.start, f.stairs, f.mask).laneShare;
        n++;
      }
      expect(n).toBeGreaterThan(0);
      expect(lane / n, `level ${level} lane share`).toBeGreaterThan(0.1);
    }
  });
});
