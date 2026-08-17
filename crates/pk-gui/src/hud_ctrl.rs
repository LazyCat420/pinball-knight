//! HUD Controller Shim — Immediate-mode HUD screen coordinator and layout switcher.
//!
//! PORTS-PARTIAL: `hud.ts` - NOT a finished port - 0 of 5 exported names carried over (0%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

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
