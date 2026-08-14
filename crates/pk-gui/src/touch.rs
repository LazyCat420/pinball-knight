//! Virtual touch dual-stick & action gamepad controls.
//!
//! PORTS: `gui/touch.ts`

pub const STICK_RADIUS: f32 = 60.0;
pub const STICK_DEADZONE: f32 = 0.15;
pub const BUTTON_RADIUS: f32 = 35.0;

#[derive(Debug, Clone, PartialEq)]
pub struct VirtualStick {
    pub center_x: f32,
    pub center_y: f32,
    pub thumb_x: f32,
    pub thumb_y: f32,
    pub radius: f32,
    pub active: bool,
    pub touch_id: Option<u64>,
}

impl Default for VirtualStick {
    fn default() -> Self {
        Self {
            center_x: 100.0,
            center_y: 300.0,
            thumb_x: 100.0,
            thumb_y: 300.0,
            radius: STICK_RADIUS,
            active: false,
            touch_id: None,
        }
    }
}

impl VirtualStick {
    pub fn sample_direction(&self) -> (f32, f32) {
        if !self.active {
            return (0.0, 0.0);
        }

        let dx = self.thumb_x - self.center_x;
        let dy = self.thumb_y - self.center_y;
        let dist = (dx * dx + dy * dy).sqrt();

        if dist < (self.radius * STICK_DEADZONE) {
            return (0.0, 0.0);
        }

        let norm_dist = (dist / self.radius).min(1.0);
        ( (dx / dist) * norm_dist, (dy / dist) * norm_dist )
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TouchButton {
    pub id: &'static str,
    pub x: f32,
    pub y: f32,
    pub radius: f32,
    pub pressed: bool,
    pub touch_id: Option<u64>,
}

impl TouchButton {
    pub fn new(id: &'static str, x: f32, y: f32) -> Self {
        Self {
            id,
            x,
            y,
            radius: BUTTON_RADIUS,
            pressed: false,
            touch_id: None,
        }
    }

    pub fn hit_test(&self, px: f32, py: f32) -> bool {
        let dx = self.x - px;
        let dy = self.y - py;
        (dx * dx + dy * dy).sqrt() <= self.radius
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TouchGamepad {
    pub enabled: bool,
    pub move_stick: VirtualStick,
    pub btn_melee: TouchButton,
    pub btn_dash: TouchButton,
    pub btn_plunger: TouchButton,
}

impl Default for TouchGamepad {
    fn default() -> Self {
        Self {
            enabled: true,
            move_stick: VirtualStick::default(),
            btn_melee: TouchButton::new("melee", 540.0, 300.0),
            btn_dash: TouchButton::new("dash", 590.0, 240.0),
            btn_plunger: TouchButton::new("plunger", 480.0, 320.0),
        }
    }
}

impl TouchGamepad {
    pub fn new() -> Self {
        Self::default()
    }

    /// Handles touch pointer start down event.
    pub fn on_touch_down(&mut self, touch_id: u64, x: f32, y: f32, screen_w: f32) {
        if !self.enabled {
            return;
        }

        // Left half of screen: Stick positioning
        if x < (screen_w * 0.5) && self.move_stick.touch_id.is_none() {
            self.move_stick.active = true;
            self.move_stick.touch_id = Some(touch_id);
            self.move_stick.center_x = x;
            self.move_stick.center_y = y;
            self.move_stick.thumb_x = x;
            self.move_stick.thumb_y = y;
            return;
        }

        // Right half of screen: Action buttons
        if self.btn_melee.hit_test(x, y) && self.btn_melee.touch_id.is_none() {
            self.btn_melee.pressed = true;
            self.btn_melee.touch_id = Some(touch_id);
            return;
        }
        if self.btn_dash.hit_test(x, y) && self.btn_dash.touch_id.is_none() {
            self.btn_dash.pressed = true;
            self.btn_dash.touch_id = Some(touch_id);
            return;
        }
        if self.btn_plunger.hit_test(x, y) && self.btn_plunger.touch_id.is_none() {
            self.btn_plunger.pressed = true;
            self.btn_plunger.touch_id = Some(touch_id);
        }
    }

    /// Handles touch pointer move event.
    pub fn on_touch_move(&mut self, touch_id: u64, x: f32, y: f32) {
        if let Some(id) = self.move_stick.touch_id {
            if id == touch_id {
                let dx = x - self.move_stick.center_x;
                let dy = y - self.move_stick.center_y;
                let dist = (dx * dx + dy * dy).sqrt();

                if dist > self.move_stick.radius {
                    self.move_stick.thumb_x = self.move_stick.center_x + (dx / dist) * self.move_stick.radius;
                    self.move_stick.thumb_y = self.move_stick.center_y + (dy / dist) * self.move_stick.radius;
                } else {
                    self.move_stick.thumb_x = x;
                    self.move_stick.thumb_y = y;
                }
            }
        }
    }

    /// Handles touch pointer release event.
    pub fn on_touch_up(&mut self, touch_id: u64) {
        if self.move_stick.touch_id == Some(touch_id) {
            self.move_stick.active = false;
            self.move_stick.touch_id = None;
            self.move_stick.thumb_x = self.move_stick.center_x;
            self.move_stick.thumb_y = self.move_stick.center_y;
        }
        if self.btn_melee.touch_id == Some(touch_id) {
            self.btn_melee.pressed = false;
            self.btn_melee.touch_id = None;
        }
        if self.btn_dash.touch_id == Some(touch_id) {
            self.btn_dash.pressed = false;
            self.btn_dash.touch_id = None;
        }
        if self.btn_plunger.touch_id == Some(touch_id) {
            self.btn_plunger.pressed = false;
            self.btn_plunger.touch_id = None;
        }
    }
}
