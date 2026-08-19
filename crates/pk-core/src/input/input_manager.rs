//! Centralized Input Ownership Manager — Focus arbitrator suppressing background room interactions.
//!
//! PORTS: `legacy/src/utils/input-manager.ts`

use std::sync::Mutex;

static INPUT_OWNER: Mutex<Option<String>> = Mutex::new(None);

pub fn set_input_owner(game_id: &str) {
    if let Ok(mut lock) = INPUT_OWNER.lock() {
        *lock = Some(game_id.to_string());
    }
}

pub fn clear_input_owner() {
    if let Ok(mut lock) = INPUT_OWNER.lock() {
        *lock = None;
    }
}

pub fn get_input_owner() -> Option<String> {
    if let Ok(lock) = INPUT_OWNER.lock() {
        lock.clone()
    } else {
        None
    }
}

pub fn is_input_owned() -> bool {
    if let Ok(lock) = INPUT_OWNER.lock() {
        lock.is_some()
    } else {
        false
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct InputOwnerState {
    pub current_owner: Option<String>,
}

impl InputOwnerState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the current input owner. While owned, background interaction is suppressed.
    pub fn set_owner(&mut self, owner: &str) {
        self.current_owner = Some(owner.to_string());
    }

    /// Clear input ownership — restores normal room interaction.
    pub fn clear_owner(&mut self) {
        self.current_owner = None;
    }

    /// Check if any game or overlay currently owns the input.
    pub fn is_owned(&self) -> bool {
        self.current_owner.is_some()
    }

    /// Get the current input owner ID (or None).
    pub fn get_owner(&self) -> Option<&str> {
        self.current_owner.as_deref()
    }
}
