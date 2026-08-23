//! Deterministic Floor Seed Avalanche — The one deterministic stream per (run, level).
//!
//! PORTS: `maze/floor-seed.ts`

use crate::rng::Mulberry32;

/// 2^32 / φ, odd — the golden-ratio avalanche constant.
pub const GOLDEN32: u32 = 0x9e3779b9;

/// The seed for one floor of one run.
/// Reproducible from two numbers that every peer agrees on without string encoding quirks.
pub fn floor_seed(run_seed: u32, level: u32) -> u32 {
    run_seed ^ level.wrapping_mul(GOLDEN32)
}

/// Returns the floor's deterministic RNG ready to draw from.
pub fn floor_rng(run_seed: u32, level: u32) -> Mulberry32 {
    Mulberry32::new(floor_seed(run_seed, level))
}
