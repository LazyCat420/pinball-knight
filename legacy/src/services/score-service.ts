/**
 * Score Service — Client-side service API for managing and persisting game leaderboards.
 * Handles server persistence with a localStorage fallback for offline or offline-mode play.
 */

import { BACKEND_API_URL } from "./api-config";

export interface LeaderboardEntry {
  name: string;
  score: number;
  altitude: number;
  meters: number;
  tunnelDepth?: number;
  createdAt?: string;
  date?: number;
}

/** Games with a server-side leaderboard. Must match GAME_IDS in the service. */
export type GameId = "raccoon-tornado" | "pinball-knight" | "ski-game" | "pirate-surf";

const DEFAULT_GAME: GameId = "raccoon-tornado";

/** Boards are per-game, so the local backup is keyed per-game too. */
function storageKey(game: GameId): string {
  return `${game}-lb`;
}

/** Per-game cache of the last successful server fetch. */
const leaderboardCaches = new Map<GameId, LeaderboardEntry[]>();

/**
 * Retrieve the high score from cache or localStorage.
 */
export function getHighScore(game: GameId = DEFAULT_GAME): number {
  const cached = leaderboardCaches.get(game);
  if (cached && cached.length > 0) {
    return cached[0]?.score || 0;
  }
  try {
    const rawData = localStorage.getItem(storageKey(game));
    const backupList: LeaderboardEntry[] = rawData ? JSON.parse(rawData) : [];
    return backupList[0]?.score || 0;
  } catch {
    return 0;
  }
}

/**
 * Retrieve the current leaderboard list from cache or localStorage.
 */
export function getLeaderboard(game: GameId = DEFAULT_GAME): LeaderboardEntry[] {
  const cached = leaderboardCaches.get(game);
  if (cached) {
    return cached;
  }
  try {
    const rawData = localStorage.getItem(storageKey(game));
    return rawData ? JSON.parse(rawData) : [];
  } catch {
    return [];
  }
}

/**
 * One row as the server projects it.
 *
 * Mirrors the SELECT list in braindeadbot-service (`tunnel_depth AS tunnelDepth`).
 * `tunnelDepth` used to be missing here even though the client SENDS it on save
 * and the server SELECTs it back, so the field was write-only: every read path
 * silently dropped it and LeaderboardEntry.tunnelDepth was never populated.
 * It is optional because rows written before the column existed return null.
 */
interface BackendScoreItem {
  name: string;
  score: number;
  altitude: number;
  meters: number;
  tunnelDepth?: number | null;
  createdAt: string;
}

/**
 * Fetch the leaderboard from the backend service. Falls back to cached local storage.
 */
export async function fetchLeaderboard(game: GameId = DEFAULT_GAME): Promise<LeaderboardEntry[]> {
  try {
    const response = await fetch(`${BACKEND_API_URL}/api/scores?game=${encodeURIComponent(game)}`);
    if (response.ok) {
      const data = await response.json();
      const rawScores: BackendScoreItem[] = data.scores || [];

      const entries = rawScores.map((scoreItem) => ({
        name: scoreItem.name,
        score: scoreItem.score,
        altitude: scoreItem.altitude,
        meters: scoreItem.meters,
        tunnelDepth: scoreItem.tunnelDepth ?? 0,
        createdAt: scoreItem.createdAt,
      }));
      leaderboardCaches.set(game, entries);

      // Sync to localStorage as backup
      try {
        localStorage.setItem(storageKey(game), JSON.stringify(entries));
      } catch {
        // Ignore quota limits
      }
      return entries;
    }
    console.warn(`[ScoreService] Leaderboard fetch for "${game}" failed: ${response.status}`);
  } catch (error) {
    console.error("[ScoreService] Error fetching leaderboard scores:", error);
  }
  return getLeaderboard(game);
}

/**
 * Persist one score locally (immediately) and to the backend.
 *
 * Returns a promise that resolves true only when the server actually accepted
 * the row. `fetch` rejects on network failure but NOT on a 4xx, so the old
 * unconditional `.then()` treated a validation 400 as a successful save and
 * refreshed the board as if the score were on it.
 *
 * @param detail per-game extras (floor reached, combo, etc.), stored as JSON
 */
export async function saveLeaderboardScore(
  score: number,
  playerName: string,
  maxAltitude: number,
  distance: number,
  tunnelDepth: number = 0,
  game: GameId = DEFAULT_GAME,
  detail?: Record<string, unknown>
): Promise<boolean> {
  const scoreEntry: LeaderboardEntry = {
    name: playerName || "???",
    score: score,
    altitude: maxAltitude,
    meters: distance,
    tunnelDepth: tunnelDepth,
  };

  // Save to localStorage immediately — the local board survives a server outage.
  try {
    const rawData = localStorage.getItem(storageKey(game));
    const backupList: LeaderboardEntry[] = rawData ? JSON.parse(rawData) : [];
    backupList.push({
      ...scoreEntry,
      date: Date.now(),
    });
    backupList.sort((firstItem, secondItem) => (secondItem.score || 0) - (firstItem.score || 0));
    localStorage.setItem(storageKey(game), JSON.stringify(backupList.slice(0, 10)));
  } catch (error) {
    console.error("[ScoreService] Error saving leaderboard locally:", error);
  }

  try {
    const response = await fetch(`${BACKEND_API_URL}/api/scores`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...scoreEntry, game, detail }),
    });
    if (!response.ok) {
      // Surface WHY — a 400 here means the payload was rejected, and silently
      // pretending otherwise is how a whole game's scores go missing.
      const body = await response.json().catch(() => ({ error: response.statusText }));
      console.error(`[ScoreService] Server rejected the score (${response.status}):`, body.error);
      return false;
    }
    await fetchLeaderboard(game).catch(() => {});
    return true;
  } catch (error) {
    console.warn("[ScoreService] Server unavailable, score saved only locally:", error);
    return false;
  }
}
