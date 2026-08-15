//! Universal Gamepad Controller Driver — Standard layout, analog deadzones, button chording.
//!
//! PORTS: `engine/gamepad.ts`

pub const STICK_DEADZONE: f32 = 0.22;
pub const AIM_DEADZONE: f32 = 0.35;

pub struct GamepadButton;
impl GamepadButton {
    pub const A: usize = 0;
    pub const B: usize = 1;
    pub const X: usize = 2;
    pub const Y: usize = 3;
    pub const LB: usize = 4;
    pub const RB: usize = 5;
    pub const LT: usize = 6;
    pub const RT: usize = 7;
    pub const BACK: usize = 8;
    pub const START: usize = 9;
    pub const L3: usize = 10;
    pub const R3: usize = 11;
    pub const D_UP: usize = 12;
    pub const D_DOWN: usize = 13;
    pub const D_LEFT: usize = 14;
    pub const D_RIGHT: usize = 15;
}

#[derive(Clone, Debug, PartialEq)]
pub struct GamepadRawState {
    pub axes: [f32; 4], // [LX, LY, RX, RY]
    pub buttons: [bool; 16],
    pub connected: bool,
}

impl Default for GamepadRawState {
    fn default() -> Self {
        Self {
            axes: [0.0; 4],
            buttons: [false; 16],
            connected: true,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct GamepadActionState {
    pub move_vec: (f32, f32),
    pub aim_vec: Option<(f32, f32)>,
    pub attack: bool,
    pub roll: bool,
    pub sprint: bool,
    pub skill_q: bool,
    pub skill_e: bool,
    pub rampage: bool,
    pub swap_weapon: bool,
    pub belt_slot: Option<u8>,
    pub menu: bool,
    pub map: bool,
}

/// Applies radial deadzone to an analog stick coordinate pair.
pub fn apply_deadzone(x: f32, y: f32, deadzone: f32) -> (f32, f32) {
    let mag = (x * x + y * y).sqrt();
    if mag <= deadzone {
        (0.0, 0.0)
    } else {
        // Rescale from [deadzone, 1.0] to [0.0, 1.0]
        let scaled_mag = ((mag - deadzone) / (1.0 - deadzone)).clamp(0.0, 1.0);
        let norm_x = x / mag;
        let norm_y = y / mag;
        (norm_x * scaled_mag, norm_y * scaled_mag)
    }
}

/// Reads raw gamepad inputs and produces resolved action states.
pub fn read_gamepad(raw: &GamepadRawState) -> GamepadActionState {
    if !raw.connected {
        return GamepadActionState::default();
    }

    // Left Stick (Movement)
    let (mx, my) = apply_deadzone(raw.axes[0], raw.axes[1], STICK_DEADZONE);

    // Right Stick (Aiming)
    let raw_aim_mag = (raw.axes[2] * raw.axes[2] + raw.axes[3] * raw.axes[3]).sqrt();
    let aim_vec = if raw_aim_mag > AIM_DEADZONE {
        Some(apply_deadzone(raw.axes[2], raw.axes[3], AIM_DEADZONE))
    } else {
        None
    };

    // D-Pad to Belt Slots
    let belt_slot = if raw.buttons[GamepadButton::D_UP] {
        Some(1)
    } else if raw.buttons[GamepadButton::D_RIGHT] {
        Some(2)
    } else if raw.buttons[GamepadButton::D_DOWN] {
        Some(3)
    } else if raw.buttons[GamepadButton::D_LEFT] {
        Some(4)
    } else {
        None
    };

    GamepadActionState {
        move_vec: (mx, my),
        aim_vec,
        attack: raw.buttons[GamepadButton::X] || raw.buttons[GamepadButton::RT],
        roll: raw.buttons[GamepadButton::A],
        sprint: raw.buttons[GamepadButton::LT],
        skill_q: raw.buttons[GamepadButton::LB],
        skill_e: raw.buttons[GamepadButton::RB],
        rampage: raw.buttons[GamepadButton::Y],
        swap_weapon: raw.buttons[GamepadButton::L3],
        belt_slot,
        menu: raw.buttons[GamepadButton::START],
        map: raw.buttons[GamepadButton::BACK],
    }
}
