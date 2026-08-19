//! Pickup Toasts — High-level delegate queue for loot notifications and card acquisition banners.
//!
//! PORTS: `pickup-toast.ts`

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ToastEntry {
    pub text: String,
    pub card_id: Option<String>,
    pub note: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct ToastQueue {
    pub entries: Vec<ToastEntry>,
}

impl ToastQueue {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }

    pub fn push_toast(&mut self, text: impl Into<String>) {
        self.entries.push(ToastEntry {
            text: text.into(),
            card_id: None,
            note: None,
        });
    }

    pub fn push_card_toast(&mut self, card_id: impl Into<String>, note: impl Into<String>) {
        let id_str = card_id.into();
        let note_str = note.into();
        self.entries.push(ToastEntry {
            text: format!("{}: {}", id_str, note_str),
            card_id: Some(id_str),
            note: Some(note_str),
        });
    }
}

pub fn clear_pickup_toasts() {}

pub fn show_pickup_toast(_text: &str) {}

pub fn show_card_toast(_id: &str, _note: &str) {}
