//! Post-processing, palette color converters, particle pool constants, and scene FX utilities.
//!
//! PORTS: `fx/heat.ts`, `fx/elements/noise.ts`, `fx/pools/sigil-pool.ts`, `fx/pools/ring-pool.ts`, `fx/elements/goo.ts`, `fx/pools/bolt-pool.ts`, `fx/pools/blade-ring.ts`, `fx/elements/frost.ts`, `fx/elements/rod.ts`, `fx/elements/element.ts`, `fx/color.ts`, `fx/pools/shared.ts`
//! PORTS-PARTIAL: `fx/index.ts` - NOT a finished port - 0 rust code lines against 7 legacy (0%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

pub mod blade_ring;
pub mod bolt_pool;
pub mod color;
pub mod element;
pub mod frost;
pub mod goo;
pub mod heat;
pub mod noise;
pub mod ring_pool;
pub mod rod;
pub mod shared;
pub mod sigil_pool;

pub use blade_ring::*;
pub use bolt_pool::*;
pub use color::*;
pub use element::*;
pub use frost::*;
pub use goo::*;
pub use heat::*;
pub use noise::*;
pub use ring_pool::*;
pub use rod::*;
pub use shared::*;
pub use sigil_pool::*;
