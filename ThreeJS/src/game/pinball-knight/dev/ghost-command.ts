/**
 * `__ghost()` — the console door onto the Ghost Maze workbench.
 *
 * Separate from `dev/ghost-maze.ts` for the reason `floor-lock.ts` is separate
 * from `monster-lab.ts`: the STATE module is pure, has no `window`, and is
 * imported by `src/net/rally.ts` and `core.ts` on the shipping path. Putting a
 * console command in it would drag a browser global into the descent funnel.
 *
 * See `dev/ghost-maze.ts` for why one pinned floor replaces sixty.
 */
import {
  enterGhostMaze,
  ghostMaze,
  setGhostMaze,
  GHOST_MAZE_NAME,
  type GhostMaze,
} from "./ghost-maze";

/** Reload rather than live-restart: `state.runSeed` is read once at launch
 *  (`core.ts`), and every atlas, biome tint and spawn stream is derived from it
 *  downstream. Re-pinning mid-run would leave a floor built against the old
 *  seed wearing the new one's name — the exact "screenshot that lies" this
 *  module exists to prevent. Same reason `__lab.imported()` reloads. */
function reload(): void {
  if (typeof window !== "undefined") window.location.reload();
}

function describe(g: GhostMaze | null): string {
  return g === null ? "OFF — playing the real game" : `${GHOST_MAZE_NAME} · depth ${g.level} · seed ${g.seed}`;
}

export interface GhostCommand {
  (level?: number): GhostMaze;
  seed: (seed: number) => GhostMaze;
  reroll: () => GhostMaze;
  off: () => boolean;
  where: () => string;
}

export function makeGhostCommand(): GhostCommand {
  const cmd = ((level?: number): GhostMaze => {
    const g = enterGhostMaze(level);
    console.log(`[ghost] ${describe(g)} — reloading. __ghost.off() to play the real game.`);
    reload();
    return g;
  }) as GhostCommand;

  cmd.seed = (seed: number): GhostMaze => {
    const g = enterGhostMaze(undefined, seed);
    console.log(`[ghost] ${describe(g)} — reloading.`);
    reload();
    return g;
  };

  /**
   * Next maze along at the same depth.
   *
   * The new seed is PRINTED, and that is the whole value of the command: a
   * maze you liked but cannot name again is a maze you cannot go back to.
   * Derived by increment rather than `Math.random()` so the sequence is
   * walkable in both directions.
   */
  cmd.reroll = (): GhostMaze => {
    const cur = ghostMaze();
    const g = enterGhostMaze(cur?.level, ((cur?.seed ?? 0) + 1) >>> 0);
    console.log(`[ghost] ${describe(g)} — __ghost.seed(${g.seed}) returns here. Reloading.`);
    reload();
    return g;
  };

  cmd.off = (): boolean => {
    setGhostMaze(null);
    console.log("[ghost] OFF — normal progression, fresh seed each run. Reloading.");
    reload();
    return true;
  };

  cmd.where = (): string => {
    const s = describe(ghostMaze());
    console.log(`[ghost] ${s}`);
    return s;
  };

  return cmd;
}
