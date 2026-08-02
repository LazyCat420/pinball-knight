import { ghostSeed } from "../dev/ghost-maze";

/**
 * `?seed=<int>` — pin the run seed so a floor regenerates identically.
 *
 * This is what makes two screenshots, two profiles or two floor censuses
 * comparable: without it every run builds a different maze and any diff between
 * them is measuring noise. Used by the renderer-migration baselines and
 * `scripts/floor-census.mjs`; harmless in normal play.
 */

/**
 * The pinned seed, or null when absent or unparseable so the caller falls back
 * to random.
 *
 * ── Two things can pin a seed, and the precedence matters ──────────────────
 *
 * `?seed=` is EXPLICIT and always wins: the renderer-migration baselines and
 * `scripts/floor-census.mjs` pin screenshots with it, and a dev flag silently
 * overriding a requested seed would make those diffs lie.
 *
 * GHOST MAZE (`dev/ghost-maze.ts`) is the standing dev pin, and it is resolved
 * HERE rather than at the launch site so "what seed is this run" has exactly
 * one answer and one home. `core.ts` calls this function unchanged — which is
 * also what its size ratchet was telling us: the concern belongs to whoever
 * owns run seeds, not to the launcher.
 */
export function readSeedParam(): number | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("seed");
  if (raw === null) return ghostSeed();
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return ghostSeed();
  // Match the random path's range: a non-negative 31-bit int.
  return Math.abs(n) % 0x7fffffff;
}
