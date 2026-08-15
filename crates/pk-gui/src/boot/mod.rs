//! Engine boot sequences, scene configuration, depth biomes, renderer lifecycle gate, and pipeline warmup.
//!
//! PORTS: `boot/warmup.ts`, `boot/scene.ts`, `boot/biomes.ts`, `boot/renderer.ts`

pub mod biomes;
pub mod renderer;
pub mod scene;
pub mod warmup;

pub use biomes::*;
pub use renderer::*;
pub use scene::*;
pub use warmup::*;
