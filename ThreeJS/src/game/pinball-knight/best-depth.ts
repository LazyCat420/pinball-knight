/**
 * Best-depth persistence.
 *
 * The one number a solo player wants between runs: how deep have I ever got.
 * The leaderboard covers the social case, but it needs a network round-trip and
 * a name — this is the local, always-available version, and it works offline.
 *
 * Deliberately its own module rather than inline `localStorage` calls in
 * `core.ts`: storage throws in private-browsing and sandboxed iframes, and a
 * game must never die because a stat couldn't be written.
 */

const KEY = "pinball-knight-best-depth";

/** Highest floor ever reached, or 0 if unknown/unreadable. */
export function loadBestDepth(): number {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return 0;
    const n = Number.parseInt(raw, 10);
    // A corrupted or hand-edited value must not poison the HUD.
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Record a floor if it beats the stored best.
 * Returns true when this run set a NEW record, so the caller can celebrate it.
 */
export function saveBestDepth(floor: number): boolean {
  if (!Number.isFinite(floor) || floor <= 0) return false;
  try {
    const prev = loadBestDepth();
    if (floor <= prev) return false;
    localStorage.setItem(KEY, String(floor));
    return true;
  } catch {
    // Storage unavailable (private mode, sandboxed iframe). Not fatal.
    return false;
  }
}
