//! UI Entry Points — Decoupled shim routing gameplay announcements, toasts, and floating combo indicators.
//!
//! PORTS-PARTIAL: `ui.ts` - NOT a finished port - 0 of 16 exported names carried over (0%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

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
