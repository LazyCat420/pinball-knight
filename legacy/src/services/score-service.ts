/**
 * Score Service — Client-side service API for managing and persisting game leaderboards.
 * Handles server persistence with a localStorage fallback for offline or offline-mode play.
 */

export interface LeaderboardEntry {
  name: string;
  score: number;
  altitude: number;
  meters: number;
  tunnelDepth?: number;
  createdAt?: string;
  date?: number;
}

const LEADERBOARD_STORAGE_KEY = "raccoon-tornado-lb";
const BACKEND_API_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5175";

let leaderboardCache: LeaderboardEntry[] | null = null;

/**
 * Retrieve the high score from cache or localStorage.
 */
export function getHighScore(): number {
  if (leaderboardCache && leaderboardCache.length > 0) {
    return leaderboardCache[0]?.score || 0;
  }
  try {
    const rawData = localStorage.getItem(LEADERBOARD_STORAGE_KEY);
    const backupList: LeaderboardEntry[] = rawData ? JSON.parse(rawData) : [];
    return backupList[0]?.score || 0;
  } catch {
    return 0;
  }
}

/**
 * Retrieve the current leaderboard list from cache or localStorage.
 */
export function getLeaderboard(): LeaderboardEntry[] {
  if (leaderboardCache) {
    return leaderboardCache;
  }
  try {
    const rawData = localStorage.getItem(LEADERBOARD_STORAGE_KEY);
    return rawData ? JSON.parse(rawData) : [];
  } catch {
    return [];
  }
}

interface BackendScoreItem {
  name: string;
  score: number;
  altitude: number;
  meters: number;
  createdAt: string;
}

/**
 * Fetch the leaderboard from the backend service. Falls back to cached local storage.
 */
export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  try {
    const response = await fetch(`${BACKEND_API_URL}/api/scores`);
    if (response.ok) {
      const data = await response.json();
      const rawScores: BackendScoreItem[] = data.scores || [];
      
      leaderboardCache = rawScores.map((scoreItem) => ({
        name: scoreItem.name,
        score: scoreItem.score,
        altitude: scoreItem.altitude,
        meters: scoreItem.meters,
        createdAt: scoreItem.createdAt,
      }));

      // Sync to localStorage as backup
      try {
        localStorage.setItem(LEADERBOARD_STORAGE_KEY, JSON.stringify(leaderboardCache));
      } catch {
        // Ignore quota limits
      }
      return leaderboardCache || [];
    }
  } catch (error) {
    console.error("[ScoreService] Error fetching leaderboard scores:", error);
  }
  return getLeaderboard();
}

/**
 * Save a new score entry. Persists to backend database (fire-and-forget) and localStorage.
 */
export function saveLeaderboardScore(
  score: number,
  playerName: string,
  maxAltitude: number,
  distance: number,
  tunnelDepth: number = 0
): void {
  const scoreEntry: LeaderboardEntry = {
    name: playerName || "???",
    score: score,
    altitude: maxAltitude,
    meters: distance,
    tunnelDepth: tunnelDepth,
  };

  // Save to localStorage immediately
  try {
    const rawData = localStorage.getItem(LEADERBOARD_STORAGE_KEY);
    const backupList: LeaderboardEntry[] = rawData ? JSON.parse(rawData) : [];
    backupList.push({
      ...scoreEntry,
      date: Date.now(),
    });
    backupList.sort((firstItem, secondItem) => (secondItem.score || 0) - (firstItem.score || 0));
    localStorage.setItem(LEADERBOARD_STORAGE_KEY, JSON.stringify(backupList.slice(0, 10)));
  } catch (error) {
    console.error("[ScoreService] Error saving leaderboard locally:", error);
  }

  // POST to server DB (async, fire-and-forget)
  fetch(`${BACKEND_API_URL}/api/scores`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(scoreEntry),
  })
    .then(() => {
      // Refresh cache after save
      fetchLeaderboard().catch(() => {});
    })
    .catch((error) => {
      console.warn("[ScoreService] Server unavailable, score saved only locally:", error);
    });
}
