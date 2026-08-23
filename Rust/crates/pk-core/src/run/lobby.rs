//! Opening the Lobby — Tavern entry lifecycle, session state, and character selection prompt gating.
//!
//! PORTS: `run/lobby.ts`

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct LobbySession {
    pub asked_character: bool,
}

impl LobbySession {
    pub fn new() -> Self {
        Self::default()
    }

    /// Test seam — resets character prompt state without reloading session.
    pub fn reset_character_prompt(&mut self) {
        self.asked_character = false;
    }

    /// Evaluates if the character select modal should open.
    /// Modal opens at most ONCE per session, and never during an active run or under headless harness autostart.
    pub fn should_prompt_character(&mut self, player_active: bool, is_harness: bool) -> bool {
        if self.asked_character || player_active || is_harness {
            return false;
        }
        self.asked_character = true;
        true
    }
}
