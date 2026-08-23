//! Renderer Boot Gate — Backend initialization lifecycle and UI-only frame presenter.
//!
//! PORTS: `boot/renderer.ts`

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct RendererBootState {
    pub ready: bool,
    pub gpu_timing_wanted: bool,
    pub pixel_pass_active: bool,
}

impl RendererBootState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Whether the backend has finished initializing and rendering is safe.
    pub fn is_ready(&self) -> bool {
        self.ready
    }

    pub fn set_ready(&mut self, ready: bool) {
        self.ready = ready;
    }

    /// Push ONE frame of pure UI to the screen right now.
    /// Returns whether a frame actually went out.
    pub fn present_ui_frame(&self) -> bool {
        if !self.ready || !self.pixel_pass_active {
            return false;
        }
        true
    }
}

pub fn is_renderer_ready(state: &RendererBootState) -> bool {
    state.is_ready()
}

pub fn present_ui_frame(state: &RendererBootState) -> bool {
    state.present_ui_frame()
}
