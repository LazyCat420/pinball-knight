//! Particle Pool Shared Constants — Particle scale derivation and linear palette color vectors.
//!
//! PORTS: `fx/pools/shared.ts`

use crate::fx::color::lin_color;

pub const DEFAULT_PPU: f32 = 64.0;

/// World-space particle scale converted from render-target pixels (1 / PPU).
pub const PARTICLE_SCALE: f32 = 1.0 / DEFAULT_PPU;

/// flame core — near white, blooms hard.
pub fn c_spark() -> [f32; 3] {
    lin_color(0xfff3c8)
}

/// flame light.
pub fn c_spark2() -> [f32; 3] {
    lin_color(0xffd98a)
}

/// flame.
pub fn c_ember() -> [f32; 3] {
    lin_color(0xf0a63c)
}

/// rot green, three shades — the horde's blood.
pub fn c_blood_g() -> [[f32; 3]; 3] {
    [
        lin_color(0x5f8a4f),
        lin_color(0x3d5c3a),
        lin_color(0x8fc46b),
    ]
}

/// blood red, three shades — the knight's, and the reaper's.
pub fn c_blood_r() -> [[f32; 3]; 3] {
    [
        lin_color(0xa83244),
        lin_color(0x6b1f2a),
        lin_color(0xd95763),
    ]
}

/// stone light — floor dust.
pub fn c_dust() -> [f32; 3] {
    lin_color(0x6b7688)
}
