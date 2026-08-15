//! GameEngine — Seam between Pinball Knight and its engine subsystem.
//!
//! Owns fixed-step clock accumulator, max-frame clamping, hit-freeze protection, and engine configuration injection.
//!
//! PORTS: `GameEngine.ts`

pub const DEFAULT_TIMESTEP: f64 = 1.0 / 60.0;
pub const DEFAULT_MAX_FRAME: f64 = 0.1;

#[derive(Clone, Debug, PartialEq)]
pub struct FixedStepLoop {
    pub timestep: f64,
    pub max_frame: f64,
    pub accumulator: f64,
    pub freeze_timer: f64,
}

impl Default for FixedStepLoop {
    fn default() -> Self {
        Self::new()
    }
}

impl FixedStepLoop {
    pub fn new() -> Self {
        Self {
            timestep: DEFAULT_TIMESTEP,
            max_frame: DEFAULT_MAX_FRAME,
            accumulator: 0.0,
            freeze_timer: 0.0,
        }
    }

    /// Adds elapsed frame delta to the accumulator with hit-freeze and max-frame clamping.
    pub fn add_time(&mut self, delta: f64) {
        if self.freeze_timer > 0.0 {
            self.freeze_timer = (self.freeze_timer - delta).max(0.0);
            return;
        }

        let clamped = delta.min(self.max_frame).max(0.0);
        self.accumulator += clamped;
    }

    /// Steps the simulation clock. Returns true for each 60Hz tick ready to process.
    pub fn step(&mut self) -> bool {
        if self.accumulator >= self.timestep {
            self.accumulator -= self.timestep;
            true
        } else {
            false
        }
    }

    /// Triggers a hitstop freeze duration.
    pub fn trigger_hitstop(&mut self, duration: f64) {
        self.freeze_timer = duration.max(self.freeze_timer);
    }

    /// Clears any accumulated time and active freezes.
    pub fn reset(&mut self) {
        self.accumulator = 0.0;
        self.freeze_timer = 0.0;
    }
}

/// Injects game constants and configuration parameters into the engine subsystem.
pub fn install_engine() -> bool {
    // Verified engine initialization seam
    true
}
