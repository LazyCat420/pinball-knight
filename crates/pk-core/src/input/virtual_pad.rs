//! Virtual Pad — Shared input surface for gamepads and touch controls with deadzone rescaling.
//!
//! PORTS: `engine/virtual-pad.ts`

#[derive(Clone, Debug, PartialEq, Default)]
pub struct VirtualPad {
    pub move_x: f32,
    pub move_z: f32,
    pub aim_x: f32,
    pub aim_y: f32,
    pub attack: bool,
    pub dodge: bool,
    pub sprint: bool,
    pub attack_tap: bool,
    pub dodge_tap: bool,
}

pub fn empty_pad() -> VirtualPad {
    VirtualPad::default()
}

/// Zeroes continuous analog movement, aim, and held buttons while preserving queued taps.
pub fn reset_pad(p: &mut VirtualPad) {
    p.move_x = 0.0;
    p.move_z = 0.0;
    p.aim_x = 0.0;
    p.aim_y = 0.0;
    p.attack = false;
    p.dodge = false;
    p.sprint = false;
}

/// Applies a radial deadzone and rescales remaining deflection so output starts smoothly from zero.
pub fn apply_deadzone(x: f32, y: f32, dead: f32) -> (f32, f32) {
    let m = (x * x + y * y).sqrt();
    if m <= dead || dead >= 1.0 {
        return (0.0, 0.0);
    }
    let scaled = ((m - dead) / (1.0 - dead)).min(1.0);
    ((x / m) * scaled, (y / m) * scaled)
}
