/**
 * The player's leaderboard name, shared across every game.
 *
 * Exists because Pirate Surf shipped posting to the shared board without ever
 * asking for a name, so the server's `"???"` default made every one of its rows
 * identical and the board useless. A name belongs to the PLAYER, not to a game,
 * so it lives here rather than being collected five separate times.
 *
 * Storage can throw (private browsing, sandboxed iframes), and no game should
 * ever fail because a nickname couldn't be written — every path degrades to the
 * default instead.
 */

const KEY = "braindeadbot-player-name";

/** Matches the server's rule (`scores.ts`): 1-12 chars, non-empty after trim. */
export const NAME_MAX = 12;

/** Used until the player sets one. Better than "???" on a shared board. */
export const DEFAULT_NAME = "KNIGHT";

/** Trim and clamp to what the server will actually accept. */
export function normalizeName(raw: string): string {
  return raw.trim().slice(0, NAME_MAX);
}

/** The stored name, or DEFAULT_NAME if unset/unreadable. */
export function getPlayerName(): string {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_NAME;
    const clean = normalizeName(raw);
    return clean.length > 0 ? clean : DEFAULT_NAME;
  } catch {
    return DEFAULT_NAME;
  }
}

/**
 * Persist a name for future runs. Returns the value actually stored, so the
 * caller can reflect the clamp back into its input rather than showing the
 * player something the server would reject.
 */
export function setPlayerName(raw: string): string {
  const clean = normalizeName(raw);
  if (clean.length === 0) return getPlayerName();
  try {
    localStorage.setItem(KEY, clean);
  } catch {
    // Non-fatal: the run still submits under whatever getPlayerName() returns.
  }
  return clean;
}
