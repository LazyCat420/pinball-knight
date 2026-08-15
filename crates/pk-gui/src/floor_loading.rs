//! Floor Loading Descent Delegate — Wall-clock driven loading progress bar for level transitions.
//!
//! PORTS: `floor-loading.ts`

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FloorLoadingHandle {
    pub level: u32,
    pub is_open: bool,
    pub progress: f32,
}

impl FloorLoadingHandle {
    pub fn new(level: u32) -> Self {
        Self {
            level,
            is_open: true,
            progress: 0.0,
        }
    }

    /// Advances progress based on elapsed wall-clock time relative to expected duration.
    pub fn update_progress(&mut self, elapsed_s: f32, duration_s: f32) {
        if duration_s <= 0.0 {
            self.progress = 1.0;
        } else {
            self.progress = (elapsed_s / duration_s).clamp(0.0, 1.0);
        }
    }

    pub fn close(&mut self) {
        self.is_open = false;
        self.progress = 1.0;
    }
}

pub fn open_floor_loading(level: u32) -> FloorLoadingHandle {
    FloorLoadingHandle::new(level)
}

pub fn is_floor_loading_open(handle: &FloorLoadingHandle) -> bool {
    handle.is_open
}
