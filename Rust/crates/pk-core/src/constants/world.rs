//! World scale and fixed-step simulation constants.
//!
//! PORTS: `constants/world.ts`

pub const TILE: f64 = 1.0;

/// Full back-wall vertical height.
pub const WALL_H: f64 = 1.1;

/// Knee-high south rim wall height for Diablo 1 camera cutaway trick.
pub const WALL_LOW: f64 = 0.35;

/// Fixed-timestep simulation step (60Hz accumulator pattern).
pub const FIXED_STEP: f64 = 1.0 / 60.0;

/// Maximum simulated delta per frame (tab-out spiral-of-death protection).
pub const MAX_FRAME: f64 = 0.1;
