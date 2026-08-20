//! Low-latency buffered gameplay input system and key mapping.
//!
//! PORTS: `engine/input.ts`

pub mod input_manager;
pub mod keymap;
pub mod virtual_pad;

pub use input_manager::*;
pub use keymap::*;
pub use virtual_pad::*;

use std::collections::{HashMap, HashSet, VecDeque};

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
pub struct InputHandle {
    pub move_dir: (f64, f64),
    pub shoot_down: bool,
    pub shoot_pressed: bool,
    pub mouse_screen: (f64, f64),
    pub plunge_power: f64,
}

impl Default for InputHandle {
    fn default() -> Self {
        Self {
            move_dir: (0.0, 0.0),
            shoot_down: false,
            shoot_pressed: false,
            mouse_screen: (0.0, 0.0),
            plunge_power: 0.0,
        }
    }
}

pub fn move_keys_map() -> HashMap<&'static str, (f64, f64)> {
    let mut map = HashMap::new();
    map.insert("w", (0.0, -1.0));
    map.insert("s", (0.0, 1.0));
    map.insert("a", (-1.0, 0.0));
    map.insert("d", (1.0, 0.0));
    map.insert("ArrowUp", (0.0, -1.0));
    map.insert("ArrowDown", (0.0, 1.0));
    map.insert("ArrowLeft", (-1.0, 0.0));
    map.insert("ArrowRight", (1.0, 0.0));
    map
}

pub fn turn_left_keys() -> HashSet<&'static str> {
    let mut s = HashSet::new();
    s.insert("q");
    s
}

pub fn turn_right_keys() -> HashSet<&'static str> {
    let mut s = HashSet::new();
    s.insert("e");
    s
}

pub fn create_input() -> InputHandle {
    InputHandle::default()
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
        self.update_move_vector();
    }

    /// Releases an input action hold.
    pub fn release_action(&mut self, action: InputAction) {
        self.held_actions.remove(&action);
        self.update_move_vector();
    }

    /// Advances the input buffer lifespan, pruning expired inputs.
    pub fn step(&mut self, dt: f64) {
        for item in self.action_buffer.iter_mut() {
            item.timer -= dt;
        }
        self.action_buffer.retain(|item| item.timer > 0.0);
    }

    /// Consumes the next matching buffered action if available.
    pub fn consume_action(&mut self, action: InputAction) -> bool {
        if let Some(pos) = self.action_buffer.iter().position(|item| item.action == action) {
            self.action_buffer.remove(pos);
            true
        } else {
            false
        }
    }

    /// Recomputes normalized movement vector from active directional keys.
    fn update_move_vector(&mut self) {
        let mut x: f64 = 0.0;
        let mut z: f64 = 0.0;

        if self.held_actions.contains(&InputAction::MoveUp) {
            z -= 1.0;
        }
        if self.held_actions.contains(&InputAction::MoveDown) {
            z += 1.0;
        }
        if self.held_actions.contains(&InputAction::MoveLeft) {
            x -= 1.0;
        }
        if self.held_actions.contains(&InputAction::MoveRight) {
            x += 1.0;
        }

        let mag = (x * x + z * z).sqrt();
        if mag > 0.0 {
            self.move_dir = (x / mag, z / mag);
        } else {
            self.move_dir = (0.0, 0.0);
        }
    }
}
