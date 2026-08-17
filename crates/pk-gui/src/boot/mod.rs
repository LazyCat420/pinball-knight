//! Engine boot sequences, scene configuration, depth biomes, renderer lifecycle gate, pipeline warmup, and sprite sheets boot loader.
//!
//! PORTS: `boot/warmup.ts`, `boot/scene.ts`, `boot/biomes.ts`, `boot/renderer.ts`
//! PORTS-PARTIAL: `boot/sheets.ts` - NOT a finished port - 27 rust code lines against 234 legacy (12%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

pub mod biomes;
pub mod renderer;
pub mod scene;
pub mod sheets;
pub mod warmup;

pub use biomes::*;
pub use renderer::*;
pub use scene::*;
pub use sheets::*;
pub use warmup::*;
