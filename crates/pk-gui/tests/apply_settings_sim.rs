// Parity test suite for Live Settings Dispatch Bridge.
// Replicates legacy/src/game/pinball-knight/gui/apply-settings.ts

use pk_gui::apply_settings::{apply_settings_live, SettingsConfig, SettingsTarget};

#[test]
fn apply_settings_live_propagates_all_configuration_flags() {
    let settings = SettingsConfig {
        muted: true,
        volume: 0.42,
        quantize: true,
        dither: false,
        scanline: true,
        outline: false,
        heat_shimmer: true,
    };

    let mut target = SettingsTarget::default();
    apply_settings_live(&settings, &mut target);

    assert!(target.sfx_muted);
    assert_eq!(target.sfx_volume, 0.42);
    assert!(target.quantize);
    assert!(!target.dither);
    assert!(target.scanline);
    assert!(!target.outline);
    assert!(target.heat_shimmer);
}
