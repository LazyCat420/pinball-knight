//! Projectile simulation, trajectory math, and collision hitboxes.
//!
//! PORTS-PARTIAL: `entities/projectiles.ts` - NOT a finished port - 1 of 13 exported names carried over (8%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

pub mod collision;
pub mod simulate;
pub mod types;

pub use collision::{check_enemy_projectile_hits, check_player_projectile_hits, ProjectileHit};
pub use simulate::step_projectiles_sim;
pub use types::*;
