//! UI Input Subsystem — Edge-triggered keyboard, mouse and gamepad input sampler for GUI modal screens.
//!
//! PORTS: `gui/input.ts`

use std::collections::{HashMap, HashSet};
use crate::im::{Pointer, UiInput};

#[derive(Debug, Clone)]
pub struct UiInputManager {
    pub held: HashSet<String>,
    pub tapped: HashMap<String, u32>,
    pub pointer_x: f64,
    pub pointer_y: f64,
    pub pointer_moved: bool,
    pub pointer_down: bool,
    pub pointer_pressed: bool,
    pub pointer_released: bool,
    pub wheel_delta: f64,
    pub typed_buf: String,
    pub live: bool,
}

impl Default for UiInputManager {
    fn default() -> Self {
        Self {
            held: HashSet::new(),
            tapped: HashMap::new(),
            pointer_x: -1.0,
            pointer_y: -1.0,
            pointer_moved: false,
            pointer_down: false,
            pointer_pressed: false,
            pointer_released: false,
            wheel_delta: 0.0,
            typed_buf: String::new(),
            live: false,
        }
    }
}

fn norm_key(key: &str) -> String {
    key.to_lowercase()
}

impl UiInputManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_live(&mut self, on: bool) {
        if self.live == on {
            return;
        }
        self.live = on;
        if !on {
            self.held.clear();
            self.tapped.clear();
            self.pointer_down = false;
            self.pointer_pressed = false;
            self.pointer_released = false;
            self.wheel_delta = 0.0;
            self.typed_buf.clear();
        }
    }

    pub fn on_key_down(&mut self, key: &str) {
        if !self.live {
            return;
        }
        let k = norm_key(key);
        if !self.held.contains(&k) {
            *self.tapped.entry(k.clone()).or_insert(0) += 1;
        }
        self.held.insert(k);

        if key.len() == 1 {
            self.typed_buf.push_str(key);
        } else if key == "Backspace" {
            self.typed_buf.push('\u{8}');
        }
    }

    pub fn on_key_up(&mut self, key: &str) {
        let k = norm_key(key);
        self.held.remove(&k);
    }

    pub fn on_mouse_move(&mut self, x: f64, y: f64) {
        if !self.live {
            return;
        }
        if (x - self.pointer_x).abs() > 0.001 || (y - self.pointer_y).abs() > 0.001 {
            self.pointer_moved = true;
        }
        self.pointer_x = x;
        self.pointer_y = y;
    }

    pub fn on_mouse_down(&mut self, x: f64, y: f64) {
        if !self.live {
            return;
        }
        self.pointer_x = x;
        self.pointer_y = y;
        self.pointer_down = true;
        self.pointer_pressed = true;
    }

    pub fn on_mouse_up(&mut self) {
        if !self.live {
            return;
        }
        self.pointer_down = false;
        self.pointer_released = true;
    }

    pub fn on_wheel(&mut self, delta_y: f64) {
        if !self.live {
            return;
        }
        self.wheel_delta += delta_y;
    }

    /// Consumes the accumulated input edges and returns the normalized `UiInput` for one painted frame.
    pub fn take_frame(&mut self, zoom: u32, offset_x: f64, offset_y: f64) -> UiInput {
        let z = zoom as f64;
        let ui_x = if self.pointer_x >= 0.0 { (self.pointer_x - offset_x) / z } else { -1.0 };
        let ui_y = if self.pointer_y >= 0.0 { (self.pointer_y - offset_y) / z } else { -1.0 };

        let pointer = Pointer {
            x: ui_x,
            y: ui_y,
            inside: ui_x >= 0.0 && ui_y >= 0.0,
            down: self.pointer_down,
            pressed: self.pointer_pressed,
            released: self.pointer_released,
        };

        let count_key = |map: &HashMap<String, u32>, keys: &[&str]| -> u32 {
            keys.iter().filter_map(|&k| map.get(k)).sum()
        };

        let up = count_key(&self.tapped, &["arrowup", "w"]);
        let down = count_key(&self.tapped, &["arrowdown", "s"]);
        let left = count_key(&self.tapped, &["arrowleft", "a"]);
        let right = count_key(&self.tapped, &["arrowright", "d"]);
        let next_tab = count_key(&self.tapped, &["e", "tab"]);
        let prev_tab = count_key(&self.tapped, &["q"]);
        let accept = count_key(&self.tapped, &["enter", " ", "z", "j"]) > 0;
        let cancel = count_key(&self.tapped, &["escape", "x", "k"]) > 0;

        let digit = (1..=9)
            .find(|&d| self.tapped.contains_key(&d.to_string()))
            .unwrap_or(0);

        let input = UiInput {
            pointer,
            pointer_moved: self.pointer_moved,
            up,
            down,
            left,
            right,
            next_tab,
            prev_tab,
            accept,
            cancel,
            scroll: self.wheel_delta,
            digit,
            typed: self.typed_buf.clone(),
        };

        // Clear edge-triggered buffers
        self.tapped.clear();
        self.pointer_moved = false;
        self.pointer_pressed = false;
        self.pointer_released = false;
        self.wheel_delta = 0.0;
        self.typed_buf.clear();

        input
    }
}
