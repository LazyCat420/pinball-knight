// Parity test suite for Virtual Touch Gamepad.
// Replicates legacy/src/game/pinball-knight/gui/touch.ts

use pk_gui::touch::TouchGamepad;

#[test]
fn touch_joystick_tracks_touch_and_clamps_deadzone() {
    let mut pad = TouchGamepad::new();

    // Touch down on left side of 640x360 screen
    pad.on_touch_down(1, 100.0, 200.0, 640.0);
    assert!(pad.move_stick.active);
    assert_eq!(pad.move_stick.center_x, 100.0);
    assert_eq!(pad.move_stick.center_y, 200.0);

    // No movement within deadzone (< 9px)
    pad.on_touch_move(1, 104.0, 200.0);
    let (dx, dy) = pad.move_stick.sample_direction();
    assert_eq!(dx, 0.0);
    assert_eq!(dy, 0.0);

    // Movement beyond deadzone
    pad.on_touch_move(1, 160.0, 200.0); // +60px right
    let (dx2, dy2) = pad.move_stick.sample_direction();
    assert!((dx2 - 1.0).abs() < 0.001);
    assert_eq!(dy2, 0.0);

    // Release touch
    pad.on_touch_up(1);
    assert!(!pad.move_stick.active);
    assert_eq!(pad.move_stick.sample_direction(), (0.0, 0.0));
}

#[test]
fn touch_buttons_trigger_and_release() {
    let mut pad = TouchGamepad::new();

    // Touch down on melee button (540, 300)
    pad.on_touch_down(2, 545.0, 305.0, 640.0);
    assert!(pad.btn_melee.pressed);
    assert!(!pad.btn_dash.pressed);

    pad.on_touch_up(2);
    assert!(!pad.btn_melee.pressed);
}
