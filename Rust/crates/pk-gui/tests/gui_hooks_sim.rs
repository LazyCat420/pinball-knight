// Parity test suite for GUI Dev Console Hooks.
// Replicates legacy/src/game/pinball-knight/dev/gui-hooks.ts

use pk_gui::dev_gui_hooks::GuiHooksController;

#[test]
fn gui_hooks_inspector_and_screen_navigation() {
    let mut ctrl = GuiHooksController::new();
    let status = ctrl.inspect();

    assert!(status.open.is_empty());
    assert_eq!(status.top, None);
    assert_eq!(status.focus, -1);
    assert!(!status.paused);

    // Open settings screen
    let s = ctrl.settings();
    assert_eq!(s.open, vec!["settings"]);
    assert_eq!(s.top, Some("settings"));
    assert!(s.paused);

    // Push orientation probe
    let msg = ctrl.probe();
    assert!(msg.contains("TOP-LEFT"));
    let p = ctrl.inspect();
    assert_eq!(p.top, Some("probe"));
    assert_eq!(p.open.len(), 2);

    // Pop top screen
    let popped = ctrl.close();
    assert_eq!(popped.top, Some("settings"));
    assert_eq!(popped.open.len(), 1);

    // Clear all screens
    let cleared = ctrl.clear();
    assert!(cleared.open.is_empty());
    assert!(!cleared.paused);
}
