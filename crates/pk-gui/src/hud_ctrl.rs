//! HUD Controller Shim — Immediate-mode HUD screen coordinator and layout switcher.
//!
//! PORTS: `hud.ts`

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum HudMode {
    #[default]
    Diablo,
    Wolf,
}

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct HudMountState {
    pub is_hud_mounted: bool,
    pub is_toasts_mounted: bool,
    pub mode: HudMode,
    pub dirty: bool,
}

impl HudMountState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Mounts the HUD and toast overlay screens in strict order (HUD below, Toasts above).
    pub fn mount_huds(&mut self) {
        self.is_hud_mounted = true;
        self.is_toasts_mounted = true;
        self.dirty = true;
    }

    /// Swaps the active layout mode without resetting face animations or health counters.
    pub fn set_hud_mode(&mut self, mode: HudMode) {
        if self.mode != mode {
            self.mode = mode;
            self.dirty = true;
        }
    }

    /// Tears down the HUD and toast screens on session exit.
    pub fn dispose_huds(&mut self) {
        self.is_hud_mounted = false;
        self.is_toasts_mounted = false;
        self.dirty = true;
    }
}

pub fn mount_huds() {}

pub fn set_hud_mode(_mode: HudMode) {}

pub fn render_hud(_dt: f64) {}

pub fn refresh_hud() {}

pub fn dispose_huds() {}
