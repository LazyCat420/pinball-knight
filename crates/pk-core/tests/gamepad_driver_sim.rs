// Parity test suite for Gamepad Controller Driver.
// Replicates legacy/src/game/pinball-knight/engine/gamepad.ts

use pk_core::engine::gamepad::{
    apply_deadzone, read_gamepad, GamepadActionState, GamepadButton, GamepadRawState,
    STICK_DEADZONE,
};

#[test]
fn gamepad_deadzone_filters_small_jitter() {
    let (x, y) = apply_deadzone(0.1, 0.1, STICK_DEADZONE);
    assert_eq!((x, y), (0.0, 0.0));

    let (x, y) = apply_deadzone(1.0, 0.0, STICK_DEADZONE);
    assert_eq!((x, y), (1.0, 0.0));
}

#[test]
fn gamepad_decodes_buttons_and_sticks() {
    let mut raw = GamepadRawState::default();
    raw.axes[0] = 0.8; // Move X
    raw.axes[1] = 0.0; // Move Y
    raw.axes[2] = 0.0; // Aim X
    raw.axes[3] = 0.9; // Aim Y

    raw.buttons[GamepadButton::A] = true; // Roll
    raw.buttons[GamepadButton::X] = true; // Attack
    raw.buttons[GamepadButton::D_DOWN] = true; // Belt 3

    let actions = read_gamepad(&raw);
    assert!(actions.move_vec.0 > 0.0);
    assert!(actions.aim_vec.is_some());
    assert!(actions.roll);
    assert!(actions.attack);
    assert_eq!(actions.belt_slot, Some(3));
    assert!(!actions.sprint);
}

#[test]
fn gamepad_disconnected_returns_empty_state() {
    let mut raw = GamepadRawState::default();
    raw.connected = false;
    raw.buttons[GamepadButton::A] = true;

    let actions = read_gamepad(&raw);
    assert_eq!(actions, GamepadActionState::default());
}
