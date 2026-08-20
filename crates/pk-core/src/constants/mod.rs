//! Core engine, level progression, economy, render, maze, world scale, player, pinball, and audio tuning constants.
//!
//! PORTS: `constants.ts`

pub mod audio;
pub mod economy;
pub mod enemies;
pub mod level;
pub mod maze;
pub mod pinball;
pub mod player;
pub mod render;
pub mod skills;
pub mod world;

pub use audio::*;
pub use economy::*;
pub use enemies::*;
pub use level::*;
pub use maze::*;
pub use pinball::*;
pub use player::*;
pub use render::*;
pub use skills::*;
pub use world::*;

pub const PPU: f64 = 64.0;
pub const WALL_H: f64 = 1.1;
pub const WALL_LOW: f64 = 0.35;
pub const TORCH_LIGHT_POOL: usize = 6;
pub const PILASTER_EVERY: usize = 6;
pub const BANNER_EVERY: usize = 12;
pub const CLUTTER_EVERY: usize = 8;
