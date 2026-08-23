//! Engine View State — Decoupled camera follow target, screen shake, and hitstop timers.
//!
//! PORTS: `engine/view-state.ts`

#[derive(Clone, Debug, PartialEq, Default)]
pub struct EngineViewState {
    pub cam_x: f32,
    pub cam_z: f32,
    pub shake_t: f32,
    pub hitstop_t: f32,
}

impl EngineViewState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Full reset on session teardown.
    pub fn reset_view(&mut self) {
        self.cam_x = 0.0;
        self.cam_z = 0.0;
        self.shake_t = 0.0;
        self.hitstop_t = 0.0;
    }

    /// Resets per-run camera and timers between floors while preserving GPU handles.
    pub fn reset_view_scalars(&mut self) {
        self.cam_x = 0.0;
        self.cam_z = 0.0;
        self.shake_t = 0.0;
        self.hitstop_t = 0.0;
    }
}
