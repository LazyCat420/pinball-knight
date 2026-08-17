//! FPS and Frame Cadence Tracker.
//!
//! PORTS-PARTIAL: `fps.ts` - NOT a finished port - 54 rust code lines against 184 legacy (29%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

use std::collections::VecDeque;

pub const FPS_WINDOW_SIZE: usize = 60;
pub const HITCH_THRESHOLD_MS: f64 = 33.33; // Frame took >2 ticks at 60Hz

#[derive(Debug, Clone, PartialEq)]
pub struct FpsTracker {
    pub frame_times: VecDeque<f64>,
    pub fps: f32,
    pub frame_time_ms: f32,
    pub min_fps: f32,
    pub max_fps: f32,
    pub hitch_count: u64,
}

impl Default for FpsTracker {
    fn default() -> Self {
        Self {
            frame_times: VecDeque::with_capacity(FPS_WINDOW_SIZE),
            fps: 60.0,
            frame_time_ms: 16.67,
            min_fps: 60.0,
            max_fps: 60.0,
            hitch_count: 0,
        }
    }
}

impl FpsTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Records one elapsed delta time frame (in seconds).
    pub fn record_frame(&mut self, dt: f64) {
        if dt <= 0.0001 {
            return;
        }

        let ms = dt * 1000.0;
        if ms >= HITCH_THRESHOLD_MS {
            self.hitch_count += 1;
        }

        self.frame_times.push_back(dt);
        if self.frame_times.len() > FPS_WINDOW_SIZE {
            self.frame_times.pop_front();
        }

        let sum: f64 = self.frame_times.iter().sum();
        let avg_dt = sum / self.frame_times.len() as f64;

        self.frame_time_ms = (avg_dt * 1000.0) as f32;
        self.fps = (1.0 / avg_dt) as f32;

        let cur_inst_fps = (1.0 / dt) as f32;
        if self.frame_times.len() == 1 {
            self.min_fps = cur_inst_fps;
            self.max_fps = cur_inst_fps;
        } else {
            self.min_fps = self.min_fps.min(cur_inst_fps);
            self.max_fps = self.max_fps.max(cur_inst_fps);
        }
    }
}
