//! Centralized Input Ownership Manager — Focus arbitrator suppressing background room interactions.
//!
//! PORTS: `legacy/src/utils/input-manager.ts`

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
