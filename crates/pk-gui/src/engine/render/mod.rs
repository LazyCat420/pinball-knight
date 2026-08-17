//! Engine rendering helpers: sprite atlas quad and billboarding engine.
//!
//! PORTS-PARTIAL: `engine/render/sprite.ts` - NOT a finished port - 66 rust code lines against 757 legacy (9%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

pub mod sprite;

pub use sprite::*;
