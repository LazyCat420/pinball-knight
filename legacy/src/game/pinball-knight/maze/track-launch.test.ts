/**
 * THE LAUNCH CHUTE GATE.
 *
 * The chute's value is entirely in its invariants — a plunger lane with a hole
 * in the side, or with a zombie standing in it, is not a plunger lane, it is a
 * corridor. Every one of the assertions below started life as a measured defect
 * on real floors, and each names the pass that caused it, because the passes
 * that break a chute are all passes that are RIGHT about ordinary track:
 *
 *   · the on-ramp pass in `growMazeAround` drills any wall with track on one
 *     side (28/60 floors kept both chute walls before `TrackMask.sealed`);
 *   · `removeWallStubs` opens any wall with 3+ open neighbours (23/60);
 *   · `connectAll` punches the shortest corridor into a stranded pocket, and
 *     the shortest corridor is usually through the chute.
 *
 * So these are regression tests in the strict sense: the next pass added to the
 * pipeline will be right about track and wrong about the chute, and this file
 * is what says so.
 */
import { describe, it, expect } from "vitest";
import { mulberry32, isWalkable, idx, T_FLOOR } from "./generator";
import { buildTrackFloor } from "./track-floor";
import { ARCHETYPES, archetypeFor, windinessFor } from "./archetypes";
import { decorateMaze } from "./decorate";
import { LAUNCH_MIN, LAUNCH_MAX, chuteTiles } from "./track-launch";
import { levelConfig } from "../constants";

function liveFloor(level: number, seed: number, archIndex?: number) {
  const cfg = levelConfig(level);
  const arch = archIndex === undefined ? archetypeFor(level) : ARCHETYPES[archIndex];
  const rng = mulberry32((seed ^ (level * 0x9e3779b9)) >>> 0);
  const windiness = windinessFor(level, arch, rng);
  const f = buildTrackFloor(cfg.cellsW, cfg.cellsH, rng, {
    profile: arch.track,
    density: Math.max(0.35, Math.min(0.85, windiness)),
  });
  return { f, arch, cfg, rng };
}

describe("the launch chute", () => {
  it("is carved on real floors, and the floor opens at its closed end", () => {
    let floors = 0;
    let withChute = 0;
    const bad: string[] = [];
    for (let level = 1; level <= 10; level++) {
      for (let a = 0; a < ARCHETYPES.length; a++) {
        for (let s = 0; s < 2; s++) {
          const seed = 0x51a7 + s * 7919 + level * 131;
          const { f, arch } = liveFloor(level, seed, a);
          if (!f) continue;
          floors++;
          if (!f.chute) continue;
          withChute++;
          const c = f.chute;
          if (f.start.i !== c.base.i || f.start.j !== c.base.j) {
            bad.push(`L${level} ${arch.id} seed=${seed}: spawn is not the chute base`);
          }
          const len = c.spine.length - 1;
          if (len < LAUNCH_MIN || len > LAUNCH_MAX) {
            bad.push(`L${level} ${arch.id} seed=${seed}: chute length ${len} outside [${LAUNCH_MIN}, ${LAUNCH_MAX}]`);
          }
          // A cardinal, and a unit one: the launch vector is used directly.
          if (Math.abs(c.dirI) + Math.abs(c.dirJ) !== 1) {
            bad.push(`L${level} ${arch.id} seed=${seed}: dir (${c.dirI},${c.dirJ}) is not a unit cardinal`);
          }
          for (const p of c.spine) {
            if (!isWalkable(f.grid, p.i, p.j)) {
              bad.push(`L${level} ${arch.id} seed=${seed}: chute spine tile (${p.i},${p.j}) is solid`);
              break;
            }
          }
        }
      }
    }
    expect(bad.join("\n")).toBe("");
    // Not "every floor must have one" — a dense circuit on a small floor can
    // legitimately leave no straight run, and the game falls back to the old
    // free-air launch. But it should be the overwhelming norm, and if it ever
    // stops being, the fallback is quietly shipping instead of the feature.
    expect(withChute / floors).toBeGreaterThan(0.9);
  });

  it("is SEALED — no pass may open its side walls", () => {
    const leaks: string[] = [];
    for (let level = 1; level <= 12; level++) {
      for (let s = 0; s < 3; s++) {
        const seed = 0x2f11 + s * 6151 + level * 97;
        const { f } = liveFloor(level, seed);
        if (!f?.chute) continue;
        const c = f.chute;
        const pi = -c.dirJ;
        const pj = c.dirI;
        // The last two cross-sections are the MERGE and are open on purpose.
        for (let t = 0; t <= c.spine.length - 3; t++) {
          const p = c.spine[t];
          for (const side of [-1, 1]) {
            const x = p.i + pi * side * 2;
            const y = p.j + pj * side * 2;
            if (x < 0 || y < 0 || x >= f.grid.w || y >= f.grid.h) continue;
            if (isWalkable(f.grid, x, y)) {
              leaks.push(`L${level} seed=${seed}: side door at (${x},${y}), ${t} tiles down the chute`);
            }
          }
        }
      }
    }
    expect(leaks.slice(0, 10).join("\n")).toBe("");
  });

  it("carries boosters aimed down the lane, and nothing else", () => {
    const bad: string[] = [];
    for (let level = 1; level <= 8; level++) {
      for (let s = 0; s < 2; s++) {
        const seed = 0x77a3 + s * 4093 + level * 211;
        const { f, cfg, rng } = liveFloor(level, seed);
        if (!f?.chute) continue;
        const c = f.chute;
        // Snapshot the lane BEFORE decorate runs. `decorateMaze` mutates the
        // grid (launch break-throughs, plaza polish), so `chuteTiles` computed
        // afterwards can include tiles that were solid when decorate made its
        // placement decisions — and a perfectly legal station-spine booster
        // just outside the lane then reads as one inside it. The product
        // computes this set on the pristine grid; so must the test.
        const inChute = new Set(chuteTiles(f.grid, c).map((t) => idx(f.grid, t.i, t.j)));
        // Mirror core.ts EXACTLY. Omitting `wallsAuthored` let decorate run its
        // own artery-bank pass on a grid the maze layer had already banked,
        // which walls tiles inside the chute and shifts the parts around it —
        // a configuration the game never builds, and the source of a failure
        // that looked like a product bug.
        const plan = decorateMaze(f.grid, rng, cfg.zombies, cfg.torches, 16, [], {
          endpoints: { start: f.start, stairs: f.stairs },
          strictLaunchers: true,
          chute: c,
          orbit: f.orbit,
          wallsAuthored: true,
          floor: level,
        });
        const tag = `L${level} seed=${seed}`;

        for (const z of plan.spawns) {
          if (inChute.has(idx(f.grid, z.i, z.j))) bad.push(`${tag}: a zombie spawns inside the launch chute`);
        }
        for (const it of plan.items) {
          if (inChute.has(idx(f.grid, it.i, it.j))) bad.push(`${tag}: loot sits inside the launch chute`);
        }
        for (const pr of plan.props) {
          if (inChute.has(idx(f.grid, pr.i, pr.j))) bad.push(`${tag}: a prop blocks the launch chute`);
        }

        const inside = plan.parts.filter((q) => inChute.has(idx(f.grid, q.i, q.j)));
        if (!inside.length) bad.push(`${tag}: the chute has no boosters — it is just a corridor`);
        for (const q of inside) {
          // The badge is the real contract: `chute` is what exempts a pad from
          // the runway re-aim and the duel breaker, so an unbadged part in the
          // lane is one those passes are still free to turn around.
          if (!q.chute) {
            bad.push(`${tag}: an unbadged '${q.kind}' sits in the chute`);
          } else if (q.kind !== "booster") {
            bad.push(`${tag}: a '${q.kind}' is in the chute; only boosters belong there`);
          } else if (q.dirI !== c.dirI || q.dirJ !== c.dirJ) {
            bad.push(`${tag}: a chute booster fires (${q.dirI},${q.dirJ}) against the lane (${c.dirI},${c.dirJ})`);
          }
        }
        // The park tile must stay bare or the plunger fires itself.
        if (inside.some((q) => q.i === c.base.i && q.j === c.base.j)) {
          bad.push(`${tag}: a booster sits on the park tile`);
        }
        // …and the merge must stay clear, or the chute's last pad duels the
        // circuit for control of where you go.
        const tail = c.spine.slice(-2);
        for (const t of tail) {
          if (inside.some((q) => q.i === t.i && q.j === t.j)) bad.push(`${tag}: a booster sits in the merge`);
        }
      }
    }
    expect([...new Set(bad)].slice(0, 10).join("\n")).toBe("");
  });

  it("keeps its shape when the floor has no room for it — null, never a stub", () => {
    // A 6x6 cell floor is far too small for an 8-tile sealed run beside a
    // circuit. The contract is that `carveLaunchChute` declines rather than
    // carving a two-tile alcove and calling it a hallway.
    for (let s = 0; s < 12; s++) {
      const rng = mulberry32(0x1234 + s);
      const f = buildTrackFloor(6, 6, rng);
      if (!f) continue;
      if (f.chute) expect(f.chute.spine.length - 1).toBeGreaterThanOrEqual(LAUNCH_MIN);
      // With no chute the endpoint picker falls back to the free double sweep,
      // and the spawn must still be a real floor tile.
      expect(f.grid.t[idx(f.grid, f.start.i, f.start.j)]).toBe(T_FLOOR);
    }
  });
});
