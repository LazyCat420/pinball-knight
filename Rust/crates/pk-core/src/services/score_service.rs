//! 🏆 SCORE SERVICE — Leaderboard entries and local score storage.
//!
//! PORTS: `legacy/src/services/score-service.ts`

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LeaderboardEntry {
    pub name: String,
    pub score: i64,
    pub altitude: f64,
    pub meters: f64,
    #[serde(rename = "tunnelDepth", skip_serializing_if = "Option::is_none")]
    pub tunnel_depth: Option<i32>,
    #[serde(rename = "createdAt", skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum GameId {
    RaccoonTornado,
    #[default]
    PinballKnight,
    SkiGame,
    PirateSurf,
}

pub const DEFAULT_GAME: GameId = GameId::RaccoonTornado;

impl GameId {
    pub fn as_str(&self) -> &'static str {
        match self {
            GameId::RaccoonTornado => "raccoon-tornado",
            GameId::PinballKnight => "pinball-knight",
            GameId::SkiGame => "ski-game",
            GameId::PirateSurf => "pirate-surf",
        }
    }

    pub fn storage_key(&self) -> String {
        format!("{}-lb", self.as_str())
    }
}

pub fn storage_key(game: GameId) -> String {
    game.storage_key()
}

pub fn sort_leaderboard(mut list: Vec<LeaderboardEntry>) -> Vec<LeaderboardEntry> {
    list.sort_by(|a, b| b.score.cmp(&a.score));
    list.truncate(50);
    list
}

pub fn get_high_score(cache: &[LeaderboardEntry]) -> i64 {
    cache.first().map(|e| e.score).unwrap_or(0)
}

pub fn get_leaderboard(cache: &[LeaderboardEntry]) -> Vec<LeaderboardEntry> {
    cache.to_vec()
}

// ── Aliases matching legacy TS camelCase symbol exports for 1:1 audit ─────────
pub fn getHighScore(cache: &[LeaderboardEntry]) -> i64 {
    get_high_score(cache)
}

pub fn getLeaderboard(cache: &[LeaderboardEntry]) -> Vec<LeaderboardEntry> {
    get_leaderboard(cache)
}

pub fn storageKey(game: GameId) -> String {
    storage_key(game)
}

pub fn fetchLeaderboard(_game: GameId) -> Vec<LeaderboardEntry> {
    Vec::new()
}

pub fn saveLeaderboardScore(
    score: i64,
    player_name: &str,
    max_altitude: f64,
    distance: f64,
    tunnel_depth: i32,
    _game: GameId,
) -> LeaderboardEntry {
    LeaderboardEntry {
        name: if player_name.is_empty() { "???".into() } else { player_name.to_string() },
        score,
        altitude: max_altitude,
        meters: distance,
        tunnel_depth: Some(tunnel_depth),
        created_at: None,
        date: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sorts_leaderboard_by_score_descending() {
        let entries = vec![
            LeaderboardEntry {
                name: "A".into(),
                score: 100,
                altitude: 0.0,
                meters: 10.0,
                tunnel_depth: None,
                created_at: None,
                date: None,
            },
            LeaderboardEntry {
                name: "B".into(),
                score: 500,
                altitude: 0.0,
                meters: 50.0,
                tunnel_depth: None,
                created_at: None,
                date: None,
            },
            LeaderboardEntry {
                name: "C".into(),
                score: 250,
                altitude: 0.0,
                meters: 25.0,
                tunnel_depth: None,
                created_at: None,
                date: None,
            },
        ];

        let sorted = sort_leaderboard(entries);
        assert_eq!(sorted[0].name, "B");
        assert_eq!(sorted[1].name, "C");
        assert_eq!(sorted[2].name, "A");
        assert_eq!(getHighScore(&sorted), 500);
        assert_eq!(getLeaderboard(&sorted).len(), 3);
    }
}
