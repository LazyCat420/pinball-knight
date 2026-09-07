/** Finished floors for tests. Uses the live author; archetype overrides are
 * explicit sweep inputs, never a second transcription of generation. */
import { ARCHETYPES } from "../maze/archetypes";
import { authorMaze } from "../maze/author-floor";

export type LiveFloor = NonNullable<ReturnType<typeof liveFloor>>;

export function liveFloor(level: number, seed: number, archIndex?: number) {
  const f = authorMaze({ level, runSeed: seed, archIndex });
  if (!f.track) return null;
  return { grid: f.grid, plan: f.plan, arch: f.arch, walkable: f.walkable };
}

/** The sweep both the density gate and the plaza gate run: every archetype, six
 *  depths, two seeds each. Skips the seeds `buildTrackFloor` declines. */
export function sweepFloors(levels: readonly number[] = [1, 3, 6, 10, 14, 20], seedsPer = 2): LiveFloor[] {
  const out: LiveFloor[] = [];
  for (let a = 0; a < ARCHETYPES.length; a++) {
    for (const level of levels) {
      for (let s = 0; s < seedsPer; s++) {
        const f = liveFloor(level, 0x2f11 + s * 6113 + level * 271 + a * 3313, a);
        if (f) out.push(f);
      }
    }
  }
  return out;
}
