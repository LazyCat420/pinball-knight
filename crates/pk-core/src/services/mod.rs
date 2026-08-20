//! 🌐 CLIENT SERVICES — Player identity, origin config, and leaderboard persistence.
//!
//! PORTS: `legacy/src/services/api-config.ts`, `legacy/src/services/player-name.ts`, `legacy/src/services/score-service.ts`

pub mod api_config;
pub mod player_name;
pub mod score_service;
pub mod youtube_service;

pub use api_config::*;
pub use player_name::*;
pub use score_service::*;
pub use youtube_service::*;
