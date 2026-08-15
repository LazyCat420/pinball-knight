//! Engine boot sequences, scene configuration, depth biomes, and pipeline warmup.
//!
//! PORTS: `boot/warmup.ts`, `boot/scene.ts`, `boot/biomes.ts`

pub mod biomes;
pub mod scene;
pub mod warmup;

pub use biomes::*;
pub use scene::*;
pub use warmup::*;
