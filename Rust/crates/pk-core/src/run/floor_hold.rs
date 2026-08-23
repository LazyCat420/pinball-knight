//! Floor Hold Coordinator — Manages presentation hold and render suspension during descent screen generation.
//!
//! PORTS: `run/floor-hold.ts`

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct FloorHoldCoordinator {
    pub held: bool,
    pub active_level: Option<u32>,
    pub active_token: Option<u64>,
    pub next_token: u64,
}

impl FloorHoldCoordinator {
    pub fn new() -> Self {
        Self {
            held: false,
            active_level: None,
            active_token: None,
            next_token: 1,
        }
    }

    /// Raises the hold for a floor descent, locking the render/sim loop.
    pub fn hold_for_floor_load(&mut self, level: u32) -> u64 {
        let token = self.next_token;
        self.next_token += 1;
        self.held = true;
        self.active_level = Some(level);
        self.active_token = Some(token);
        token
    }

    /// Lowers the hold if the passed token matches the currently active screen.
    pub fn release_floor_load(&mut self, token: Option<u64>) {
        if token.is_none() || self.active_token == token {
            self.held = false;
            self.active_token = None;
            self.active_level = None;
        }
    }

    /// True while the descent screen owns the display — loop renders nothing.
    pub fn is_render_held(&self) -> bool {
        self.held
    }
}
