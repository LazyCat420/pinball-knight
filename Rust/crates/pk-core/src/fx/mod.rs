//! Post-processing, palette color converters, particle pool constants, and scene FX utilities.
//!
//! PORTS: `fx/index.ts`

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

pub fn create_vfx() {}

pub fn push_heat_field() {}

pub fn dropped_heat_sources() -> usize {
    0
}
