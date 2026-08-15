// Parity test suite for HUD Controller Shim.
// Replicates legacy/src/game/pinball-knight/hud.ts

use pk_gui::hud_ctrl::{HudMode, HudMountState};

#[test]
fn hud_mount_state_lifecycle_and_mode_switching() {
    let mut hud = HudMountState::new();
    assert!(!hud.is_hud_mounted);
    assert!(!hud.is_toasts_mounted);
    assert_eq!(hud.mode, HudMode::Diablo);

    hud.mount_huds();
    assert!(hud.is_hud_mounted);
    assert!(hud.is_toasts_mounted);
    assert!(hud.dirty);

    hud.dirty = false;
    hud.set_hud_mode(HudMode::Wolf);
    assert_eq!(hud.mode, HudMode::Wolf);
    assert!(hud.dirty);

    hud.dispose_huds();
    assert!(!hud.is_hud_mounted);
    assert!(!hud.is_toasts_mounted);
}
