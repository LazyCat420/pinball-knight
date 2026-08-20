//! Scroll Probe Test Harness — Intercepts clipping viewports and translations to verify content extent alignment.
//!
//! PORTS: `gui/screens/scroll-probe.ts`

use crate::im::Rect;

#[derive(Clone, Debug, PartialEq, Default)]
pub struct ScrollProbe {
    pub clips: Vec<Rect>,
    pub shifts: Vec<f64>,
    pub region_bottom: f64,
    pub depth: usize,
    pub pending_rect: Option<Rect>,
}

impl ScrollProbe {
    pub fn new() -> Self {
        Self::default()
    }

    /// Marks painted geometry: bottom bounds are recorded only within active clip depth.
    pub fn mark(&mut self, y: f64, h: f64) {
        if self.depth > 0 {
            self.region_bottom = self.region_bottom.max(y + h);
        }
    }

    /// Records pending rectangle for next clip call.
    pub fn rect(&mut self, r: Rect) {
        self.pending_rect = Some(r);
    }

    /// Enters a clip scope and saves the viewport rect.
    pub fn clip(&mut self) {
        if let Some(r) = self.pending_rect.take() {
            self.clips.push(r);
        }
        self.depth += 1;
    }

    /// Exits a clip scope.
    pub fn restore(&mut self) {
        self.depth = self.depth.saturating_sub(1);
    }

    /// Records a scroll translation offset.
    pub fn translate(&mut self, y: f64) {
        self.shifts.push(-y);
    }
}

pub fn scroll_probe() -> ScrollProbe {
    ScrollProbe::new()
}

pub fn paint_frame() {}

pub fn frame_for() -> Rect {
    Rect {
        x: 0.0,
        y: 0.0,
        w: 0.0,
        h: 0.0,
    }
}
