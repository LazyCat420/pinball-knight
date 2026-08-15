//! Engine boot sequences, scene configuration, and pipeline warmup.
//!
//! PORTS: `boot/warmup.ts`, `boot/scene.ts`

pub mod scene;
pub mod warmup;

pub use scene::*;
pub use warmup::*;
