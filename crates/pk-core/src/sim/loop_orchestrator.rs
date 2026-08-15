//! SIMULATION FRAME LOOP ORCHESTRATOR — RAF frame driver: simulate, then present, then render.
//!
//! Manages fixed-step accumulation, visual heat shimmer clock progression, pause gating, and multi-tick sub-stepping.
//!
//! PORTS: `sim/loop.ts`

use crate::constants::{FIXED_STEP, MAX_FRAME};

#[derive(Clone, Debug, PartialEq)]
pub struct FrameLoopState {
    pub accumulator: f64,
    pub fixed_step: f64,
    pub max_frame: f64,
    pub heat_time: f64,
    pub is_paused: bool,
    pub frames_presented: u64,
}

impl Default for FrameLoopState {
    fn default() -> Self {
        Self::new()
    }
}

impl FrameLoopState {
    pub fn new() -> Self {
        Self {
            accumulator: 0.0,
            fixed_step: FIXED_STEP,
            max_frame: MAX_FRAME,
            heat_time: 0.0,
            is_paused: false,
            frames_presented: 0,
        }
    }

    /// Ticks the frame loop, running `simulate_fn` for each fixed step consumed. Returns the count of steps run.
    pub fn tick<F: FnMut()>(&mut self, dt: f64, mut simulate_fn: F) -> u32 {
        self.frames_presented += 1;
        // Heat shimmer clock runs in REAL unpaused seconds
        self.heat_time += dt;

        if self.is_paused {
            return 0;
        }

        let clamped = dt.min(self.max_frame).max(0.0);
        self.accumulator += clamped;

        let mut steps = 0;
        while self.accumulator >= self.fixed_step {
            self.accumulator -= self.fixed_step;
            simulate_fn();
            steps += 1;
        }

        steps
    }

    /// Drops banked simulation time. Call beside `reset_state()`.
    pub fn reset_clock(&mut self) {
        self.accumulator = 0.0;
    }
}
