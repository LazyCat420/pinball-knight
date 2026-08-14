//! Spawning subsystems — The Tide rolling reinforcements, scripted debug spawns, and authored room populations.
//!
//! PORTS: `spawn/tide.ts`, `debug-spawn.ts`

pub mod debug_spawn;
pub mod tide;

pub use debug_spawn::*;
pub use tide::*;
