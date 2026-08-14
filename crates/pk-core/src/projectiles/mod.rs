//! Projectile simulation, trajectory math, and collision hitboxes.
//!
//! PORTS: `entities/projectiles.ts`

pub mod collision;
pub mod simulate;
pub mod types;

pub use collision::{check_enemy_projectile_hits, check_player_projectile_hits, ProjectileHit};
pub use simulate::step_projectiles_sim;
pub use types::*;
