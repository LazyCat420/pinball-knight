//! Core engine, level progression, economy, render, maze, world scale, and audio tuning constants.
//!
//! PORTS: `constants/economy.ts`, `constants/maze.ts`, `constants/world.ts`, `constants/audio.ts`, `constants/level.ts`
//! PORTS-PARTIAL: `constants.ts` - NOT a finished port - 1 rust code lines against 10 legacy (10%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

pub mod audio;
pub mod economy;
pub mod level;
pub mod maze;
pub mod pinball;
pub mod render;
pub mod world;

pub use audio::*;
pub use economy::*;
pub use level::*;
pub use maze::*;
pub use pinball::*;
pub use render::*;
pub use world::*;
