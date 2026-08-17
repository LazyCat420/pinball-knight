//! Stagger, pain interruption, and squash-and-stretch deformation physics.
//!
//! PORTS: `entities/stagger.ts`

pub use crate::stagger::*;

pub const SQUASH_RECOVER_TIME: f64 = 0.18;
pub const SQUASH_DEPTH_MAX: f64 = 0.30;
pub const SQUASH_MIN_SPEED: f64 = 5.0;

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct SquashState {
    pub timer: f64,
    pub amplitude: f64,
    pub normal_x: f64,
    pub normal_z: f64,
}

impl SquashState {
    pub fn trigger(&mut self, normal_x: f64, normal_z: f64, speed: f64) {
        if speed < SQUASH_MIN_SPEED {
            return;
        }
        self.amplitude = (speed / (SQUASH_MIN_SPEED * 2.0)).min(1.0);
        self.timer = SQUASH_RECOVER_TIME;
        self.normal_x = normal_x;
        self.normal_z = normal_z;
    }

    pub fn step(&mut self, dt: f64) {
        if self.timer > 0.0 {
            self.timer = (self.timer - dt).max(0.0);
        }
    }

    pub fn scale(&self) -> (f32, f32) {
        if self.timer <= 0.0 {
            return (1.0, 1.0);
        }
        let t = (self.timer / SQUASH_RECOVER_TIME).clamp(0.0, 1.0);
        let depth =
            (SQUASH_DEPTH_MAX * self.amplitude * (t * std::f64::consts::FRAC_PI_2).sin()) as f32;
        (1.0 - depth * 0.7, 1.0 + depth * 0.5)
    }
}
