// Parity test suite for UI Edge-Triggered Input Manager.
// Replicates legacy/src/game/pinball-knight/gui/input.ts

use pk_gui::input::UiInputManager;

#[test]
fn ui_input_inactive_ignores_all_keys() {
    let mut mgr = UiInputManager::new();
    mgr.set_live(false);

    mgr.on_key_down("Enter");
    let input = mgr.take_frame(1, 0.0, 0.0);
    assert!(!input.accept);
}

#[test]
fn ui_input_edge_triggers_and_clears_next_frame() {
    let mut mgr = UiInputManager::new();
    mgr.set_live(true);

    // Frame 1: Key pressed
    mgr.on_key_down("Enter");
    let input1 = mgr.take_frame(1, 0.0, 0.0);
    assert!(input1.accept);

    // Frame 2: Key still held down -> edge is cleared
    let input2 = mgr.take_frame(1, 0.0, 0.0);
    assert!(!input2.accept);

    // Frame 3: Key released then pressed again
    mgr.on_key_up("Enter");
    mgr.on_key_down("Enter");
    let input3 = mgr.take_frame(1, 0.0, 0.0);
    assert!(input3.accept);
}

#[test]
fn ui_input_directional_counts_repeats() {
    let mut mgr = UiInputManager::new();
    mgr.set_live(true);

    mgr.on_key_down("ArrowDown");
    mgr.on_key_down("s");
    let input = mgr.take_frame(1, 0.0, 0.0);
    assert_eq!(input.down, 2);
}

#[test]
fn ui_input_pointer_coordinates_scale_with_zoom() {
    let mut mgr = UiInputManager::new();
    mgr.set_live(true);

    mgr.on_mouse_move(120.0, 80.0);
    mgr.on_mouse_down(120.0, 80.0);

    let input = mgr.take_frame(2, 0.0, 0.0);
    assert_eq!(input.pointer.x, 60.0);
    assert_eq!(input.pointer.y, 40.0);
    assert!(input.pointer.pressed);
    assert!(input.pointer.down);
}
