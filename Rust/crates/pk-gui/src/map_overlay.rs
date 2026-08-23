//! Floor Map Overlay State Gate — Modal availability gating and screen toggle state.
//!
//! PORTS: `map-overlay.ts`

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct MapOverlayState {
    pub suppressed: bool,
    pub is_open: bool,
}

impl MapOverlayState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets suppression state. When suppressed, closes the map if open.
    pub fn set_map_suppressed(&mut self, on: bool) {
        self.suppressed = on;
        if on {
            self.is_open = false;
        }
    }

    pub fn is_floor_map_open(&self) -> bool {
        self.is_open
    }

    pub fn close_floor_map(&mut self) {
        self.is_open = false;
    }

    /// Toggles the map overlay and returns whether the map is open AFTER the toggle.
    pub fn toggle_floor_map(&mut self) -> bool {
        if self.suppressed {
            return false;
        }
        if self.is_open {
            self.is_open = false;
            false
        } else {
            self.is_open = true;
            true
        }
    }
}
