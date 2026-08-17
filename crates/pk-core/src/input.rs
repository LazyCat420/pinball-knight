//! PORTS: `input/keymap.ts`, `engine/virtual-pad.ts`
//! PORTS-PARTIAL: `engine/input.ts` - NOT a finished port - 59 rust code lines against 214 legacy (28%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md
//! PORTS-PARTIAL: `legacy/src/utils/input-manager.ts` - NOT a finished port - 0 of 4 exported names carried over (0%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

pub mod input_manager;
pub mod keymap;
pub mod virtual_pad;

pub use input_manager::*;
pub use keymap::*;
pub use virtual_pad::*;

use std::collections::{HashSet, VecDeque};

pub const INPUT_BUFFER_SECONDS: f64 = 0.15;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum InputAction {
    MoveUp,
    MoveDown,
    MoveLeft,
    MoveRight,
    MeleeSlash,
    DashRoll,
    PlungerPull,
    UseBelt(usize),
    ToggleMenu,
    ToggleMap,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BufferedAction {
    pub action: InputAction,
    pub timer: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct GameplayInputState {
    pub held_actions: HashSet<InputAction>,
    pub action_buffer: VecDeque<BufferedAction>,
    pub move_dir: (f64, f64),
    pub plunger_held: bool,
}

impl Default for GameplayInputState {
    fn default() -> Self {
        Self {
            held_actions: HashSet::new(),
            action_buffer: VecDeque::new(),
            move_dir: (0.0, 0.0),
            plunger_held: false,
        }
    }
}

impl GameplayInputState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Triggers an input action press, buffering it for the active window.
    pub fn press_action(&mut self, action: InputAction) {
        self.held_actions.insert(action);
        self.action_buffer.push_back(BufferedAction {
            action,
            timer: INPUT_BUFFER_SECONDS,
        });
        self.recompute_move_dir();
    }

    /// Releases an input action.
    pub fn release_action(&mut self, action: InputAction) {
        self.held_actions.remove(&action);
        self.recompute_move_dir();
    }

    /// Recomputes normalized movement heading vector from held movement actions.
    fn recompute_move_dir(&mut self) {
        let mut dx: f64 = 0.0;
        let mut dz: f64 = 0.0;
        if self.held_actions.contains(&InputAction::MoveLeft) {
            dx -= 1.0;
        }
        if self.held_actions.contains(&InputAction::MoveRight) {
            dx += 1.0;
        }
        if self.held_actions.contains(&InputAction::MoveUp) {
            dz -= 1.0;
        }
        if self.held_actions.contains(&InputAction::MoveDown) {
            dz += 1.0;
        }

        let len = (dx * dx + dz * dz).sqrt();
        if len > 0.001 {
            self.move_dir = (dx / len, dz / len);
        } else {
            self.move_dir = (0.0, 0.0);
        }
    }

    /// Ticks the input buffer and purges expired actions.
    pub fn step(&mut self, dt: f64) {
        for action in self.action_buffer.iter_mut() {
            action.timer -= dt;
        }
        self.action_buffer.retain(|a| a.timer > 0.0);
    }

    /// Attempts to consume a buffered action if available.
    pub fn consume_action(&mut self, action: InputAction) -> bool {
        if let Some(pos) = self.action_buffer.iter().position(|a| a.action == action) {
            self.action_buffer.remove(pos);
            true
        } else {
            false
        }
    }
}
