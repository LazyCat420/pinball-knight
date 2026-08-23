//! UI Entry Points — Decoupled shim routing gameplay announcements, toasts, and floating combo indicators.
//!
//! PORTS: `ui.ts`

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShopEntry {
    pub id: String,
    pub label: String,
    pub icon: String,
    pub price: u32,
    pub detail: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ToastAnnouncement {
    pub text: String,
    pub subtext: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct FloatingComboSpawn {
    pub combo: u32,
    pub sx: f32,
    pub sy: f32,
}

pub fn create_toast_announcement(text: &str, subtext: &str) -> ToastAnnouncement {
    ToastAnnouncement {
        text: text.to_string(),
        subtext: subtext.to_string(),
    }
}

pub fn create_pickup_note(text: &str) -> ToastAnnouncement {
    ToastAnnouncement {
        text: text.to_string(),
        subtext: String::new(),
    }
}

pub fn create_floating_combo(combo: u32, sx: f32, sy: f32) -> FloatingComboSpawn {
    FloatingComboSpawn { combo, sx, sy }
}

pub fn show_toast(text: &str, subtext: &str) {
    let _ = create_toast_announcement(text, subtext);
}

pub fn show_pickup_note(text: &str) {
    let _ = create_pickup_note(text);
}

pub fn spawn_floating_combo(combo: u32, sx: f32, sy: f32) {
    let _ = create_floating_combo(combo, sx, sy);
}

pub fn dispose_floating_combos() {}

pub fn ensure_wolf_fonts() {}

pub fn create_hud() {}

pub fn update_hud() {}

pub fn create_fps_overlay() {}

pub fn set_fps_overlay() {}

pub fn update_fps_streak() {}

pub fn flash_fps_muzzle() {}

pub fn create_boss_bar() {}

pub fn update_boss_bar() {}

pub fn create_plunger_meter() {}

pub fn update_plunger_meter() {}

pub fn show_controls_hint() {}
