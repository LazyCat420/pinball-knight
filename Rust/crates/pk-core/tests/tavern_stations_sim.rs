// Parity test suite for Tavern Station Focus & Lighting FX.
// Replicates legacy/src/scenes/tavern/stations.ts

use pk_core::tavern::stations::{compute_accent_intensity, refresh_focus, StationFxState};

#[test]
fn station_fx_state_focus_and_fade_lifecycle() {
    let mut fx = StationFxState::new();
    assert!(!fx.disc_visible);

    // Focus station
    fx.set_focus(Some(("shop", [10.0, 0.0, 5.0], 0xffaa00)));
    assert!(fx.disc_visible);
    assert_eq!(fx.disc_pos, [10.0, 0.03, 5.0]);
    assert_eq!(fx.disc_color, 0xffaa00);

    // Fade in over time
    fx.update(0.1, 1.0);
    assert!(fx.fade > 0.0);
    assert!(fx.disc_opacity > 0.0);

    // Unfocus
    fx.set_focus(None);
    assert_eq!(fx.current_station, None);

    // Fade out
    fx.update(0.5, 2.0); // 0.5 * 6.0 = 3.0 > 1.0 -> fades to 0
    assert_eq!(fx.fade, 0.0);
    assert!(!fx.disc_visible);
}

#[test]
fn accent_intensity_breathing_curves() {
    let unfocused = compute_accent_intensity(1.0, false, 0.0, 0.0);
    assert_eq!(unfocused, 1.0); // 1.0 + sin(0) = 1.0

    let focused = compute_accent_intensity(1.0, true, 0.0, 0.0);
    assert_eq!(focused, 1.5); // (1.0 + 0) * 1.5 = 1.5
}

#[test]
fn refresh_focus_detects_station_transitions() {
    assert!(!refresh_focus(Some("shop"), Some("shop")));
    assert!(refresh_focus(Some("shop"), Some("armory")));
    assert!(refresh_focus(Some("shop"), None));
    assert!(refresh_focus(None, Some("forge")));
}
