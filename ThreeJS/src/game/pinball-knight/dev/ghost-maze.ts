/**
 * GHOST MAZE — the named workbench floor.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * There are no levels in this game. There is one generator and a depth number
 * that indexes three data tables, and measured over L1-40 `levelConfig` yields
 * **24 distinct outcomes, of which L24-L40 are byte-identical** — every budget
 * frozen (torches from L8, zombies from L10, parts from L11, grid from L23/24)
 * and only the boss's HP still climbing. `archetypeFor` is literally
 * `ARCHETYPES[(level - 1) % 5]`. So "sixty levels" is five geometry archetypes
 * times four themes, re-rolled.
 *
 * Debugging against that means debugging sixty forks of one maze. This pins
 * ONE of them and gives it a name, so the thing under test is the same thing
 * every reload.
 *
 * ── What it pins, and why all three are needed ─────────────────────────────
 *
 * `__lab.lock(n)` already pins the DEPTH (`dev/floor-lock.ts`) — but depth
 * alone is not a floor. `state.runSeed` is redrawn from `Math.random()` on
 * every launch (`core.ts`), and `floorRng(runSeed, level)` means a new run is a
 * new maze at the same depth. Pinning one without the other gets you a
 * different floor with the same number, which is the failure this is for.
 *
 * So Ghost Maze pins the PAIR — depth and run seed — and names the result.
 * That is the whole idea: not a new floor type, a *stable identity* for one
 * point in the generator's space.
 *
 * ── Rules it follows (the same three `floor-lock.ts` states) ───────────────
 *
 *  · OFF by default. A fresh profile plays the real game.
 *  · Persisted in localStorage, because it exists to survive the reloads.
 *  · LOUD. It logs when it takes over, so nobody debugs a "bug" that is this
 *    flag — and the floor's name replaces the depth caption on screen.
 *
 * It deliberately does NOT gate progression, delete depth, or change spawn
 * rules. Enemy unlocks are level-based (`<NAME>_FROM_LEVEL`, everything open by
 * L5), so moving the pinned depth changes the roster — that is a feature of
 * choosing which floor to work on, not a bug to paper over.
 *
 * Usage, from the browser console:
 *   __ghost()            work on Ghost Maze (depth 5, the full roster)
 *   __ghost(3)           pin a different depth, same seed
 *   __ghost.seed(1234)   a different maze at the same depth
 *   __ghost.reroll()     next maze along, printed so you can pin it again
 *   __ghost.off()        back to the real game
 *   __ghost.where()      what is pinned right now
 */

const KEY = "pinball-knight-ghost-maze";

/**
 * The default pinning.
 *
 * Depth 5 rather than 1 on purpose: every enemy in the bestiary is unlocked by
 * level 5 and nothing at all is gated above it, so 5 is the shallowest floor
 * that can show you the whole roster. Level 1 is `warrens` and a deliberately
 * thin cast — a fine floor to test, a poor floor to *develop* against.
 *
 * The seed is arbitrary and that is fine; what matters is that it never
 * changes. `reroll()` is there for when this particular maze stops being
 * interesting.
 */
const DEFAULT_LEVEL = 5;
const DEFAULT_SEED = 0x6057;
export const GHOST_MAZE_NAME = "GHOST MAZE";

export interface GhostMaze {
  level: number;
  seed: number;
}

/** Memoised: the descent path reads this, and it must not be a storage hit. */
let cached: GhostMaze | null | undefined;

/** The pinned floor, or null when the real game is running. */
export function ghostMaze(): GhostMaze | null {
  if (cached !== undefined) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) {
      cached = null;
    } else {
      const p = JSON.parse(raw) as Partial<GhostMaze>;
      const level = Number(p.level);
      const seed = Number(p.seed);
      cached =
        Number.isFinite(level) && level > 0 && Number.isFinite(seed)
          ? { level: Math.floor(level), seed: seed >>> 0 }
          : null;
    }
  } catch {
    cached = null; // private mode, quota, or corrupt JSON — just play the game
  }
  return cached;
}

export function setGhostMaze(next: GhostMaze | null): GhostMaze | null {
  cached = next && next.level > 0 ? { level: Math.floor(next.level), seed: next.seed >>> 0 } : null;
  try {
    if (cached === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    // Not fatal — session-only this time.
  }
  return cached;
}

/** Turn it on, filling in whatever was not given from the current pin. */
export function enterGhostMaze(level?: number, seed?: number): GhostMaze {
  const cur = ghostMaze();
  const next: GhostMaze = {
    level: level ?? cur?.level ?? DEFAULT_LEVEL,
    seed: seed ?? cur?.seed ?? DEFAULT_SEED,
  };
  setGhostMaze(next);
  return next;
}

/** The pinned run seed, or null when the real game is running. Read by
 *  `boot/seed-param.ts`, which owns "what seed is this run". */
export function ghostSeed(): number | null {
  const g = ghostMaze();
  if (g === null) return null;
  console.warn(
    `[ghost-maze] ${GHOST_MAZE_NAME} — depth ${g.level}, seed ${g.seed}. __ghost.off() to play the real game.`,
  );
  return g.seed;
}

/** The depth to start at. Identity when the pin is off. */
export function applyGhostLevel(drawn: number): number {
  const g = ghostMaze();
  return g === null ? drawn : g.level;
}

/**
 * What to CALL this floor on screen.
 *
 * Returning the name here rather than at each call site is what makes the flag
 * loud: the descent toast and the loading screen both caption themselves, so a
 * screenshot taken in Ghost Maze is self-identifying and cannot be mistaken for
 * one from a real run.
 */
export function ghostFloorLabel(): string | null {
  const g = ghostMaze();
  return g === null ? null : `${GHOST_MAZE_NAME} · d${g.level} · #${g.seed}`;
}

/** Test seam — drops the memo so a fresh localStorage is re-read. */
export function __resetGhostMazeCache(): void {
  cached = undefined;
}
