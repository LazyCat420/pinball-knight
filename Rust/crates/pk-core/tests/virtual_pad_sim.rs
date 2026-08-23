// Parity test suite for Virtual Pad Input Model.
// Replicates legacy/src/game/pinball-knight/engine/virtual-pad.ts

use pk_core::input::virtual_pad::{apply_deadzone, empty_pad, reset_pad};

#[test]
fn deadzone_rescaling_smooths_start_of_motion() {
    // 1. Inside deadzone (e.g. 0.15 with threshold 0.25) -> strictly 0
    let (x, y) = apply_deadzone(0.15, 0.0, 0.25);
    assert_eq!(x, 0.0);
    assert_eq!(y, 0.0);

    // 2. Just past deadzone (0.25) -> magnitude near 0.0
    let (x, _) = apply_deadzone(0.2501, 0.0, 0.25);
    assert!(x > 0.0 && x < 0.01);

    // 3. Midpoint (0.625) -> (0.625 - 0.25) / 0.75 = 0.50
    let (x, _) = apply_deadzone(0.625, 0.0, 0.25);
    assert!((x - 0.50).abs() < 1e-4);

    // 4. Full deflection (1.0) -> exactly 1.0
    let (x, _) = apply_deadzone(1.0, 0.0, 0.25);
    assert!((x - 1.0).abs() < 1e-4);
}

#[test]
fn reset_pad_clears_continuous_state_but_preserves_taps() {
    let mut pad = empty_pad();
    pad.move_x = 0.8;
    pad.move_z = -0.5;
    pad.aim_x = 1.0;
    pad.attack = true;
    pad.dodge = true;
    pad.sprint = true;
    pad.attack_tap = true;
    pad.dodge_tap = true;

    reset_pad(&mut pad);

    assert_eq!(pad.move_x, 0.0);
    assert_eq!(pad.move_z, 0.0);
    assert_eq!(pad.aim_x, 0.0);
    assert!(!pad.attack);
    assert!(!pad.dodge);
    assert!(!pad.sprint);

    // Queued edge taps are preserved for the reader
    assert!(pad.attack_tap);
    assert!(pad.dodge_tap);
}
