//! SIMULATION FRAME LOOP ORCHESTRATOR — RAF frame driver: simulate, then present, then render.
//!
//! Manages fixed-step accumulation, visual heat shimmer clock progression, pause gating, and multi-tick sub-stepping.
//!
//! PORTS: `sim/loop.ts`

use crate::constants::{FIXED_STEP, MAX_FRAME};
use std::sync::Mutex;

static FRENZY_OVERRIDE: Mutex<Option<f64>> = Mutex::new(None);

pub fn set_frenzy_override(v: Option<f64>) {
    if let Ok(mut lock) = FRENZY_OVERRIDE.lock() {
        *lock = v;
    }
}

pub fn get_frenzy_override() -> Option<f64> {
    if let Ok(lock) = FRENZY_OVERRIDE.lock() {
        *lock
    } else {
        None
    }
}

pub fn reset_sim_clock() {}

pub fn sim_loop(_now: f64) {}

pub fn torch_flicker(elapsed: f64, i: usize) -> f64 {
    let t = elapsed * 6.0 + i as f64 * 2.1;
    6.0 + t.sin() * 0.7 + (t * 2.7).sin() * 0.4
}

pub fn ember_spawn_cadence(elapsed: f64, rate_per_sec: f64) -> bool {
    let phase = (elapsed * rate_per_sec).fract();
    phase < 0.1
}

pub fn ambient_audio_step(elapsed: f64) -> f32 {
    ((elapsed * 0.2).sin() * 0.5 + 0.5) as f32
}

pub fn flame_pulse_lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t.clamp(0.0, 1.0)
}

#[derive(Clone, Debug, PartialEq)]
pub struct FrameLoopState {
    pub accumulator: f64,
    pub fixed_step: f64,
    pub max_frame: f64,
    pub heat_time: f64,
    pub is_paused: bool,
    pub frames_presented: u64,
    pub sub_steps_taken: u64,
    pub total_sim_time: f64,
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
            sub_steps_taken: 0,
            total_sim_time: 0.0,
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
            self.total_sim_time += self.fixed_step;
            self.sub_steps_taken += 1;
            simulate_fn();
            steps += 1;
        }

        steps
    }

    /// Drops banked simulation time. Call beside `reset_state()`.
    pub fn reset_sim_clock(&mut self) {
        self.accumulator = 0.0;
    }

    pub fn reset_clock(&mut self) {
        self.reset_sim_clock();
    }

    pub fn set_paused(&mut self, paused: bool) {
        self.is_paused = paused;
    }

    pub fn average_steps_per_frame(&self) -> f64 {
        if self.frames_presented == 0 {
            0.0
        } else {
            self.sub_steps_taken as f64 / self.frames_presented as f64
        }
    }
}
