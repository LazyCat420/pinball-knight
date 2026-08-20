// Parity test suite for Player Settings Persistence.
// Replicates legacy/src/game/pinball-knight/settings-save.ts

use pk_core::settings_save::DungeonSettings;

#[test]
fn default_settings_match_legacy_expectations() {
    let settings = DungeonSettings::default();
    assert!(!settings.muted);
    assert_eq!(settings.volume, 1.0);
    assert!(settings.heat);
    assert!(settings.quantize);
    assert!(settings.dither);
    assert!(!settings.scanlines);
    assert!(!settings.outlines);
    assert_eq!(settings.camera_zoom, 1.0);
    assert!(!settings.speedrun);
    assert!(!settings.haul_reveal);
}

#[test]
fn snap_volume_rounds_to_notches() {
    let mut settings = DungeonSettings::default();
    settings.snap_volume(0.33);
    assert!((settings.volume - 0.35).abs() < 1e-4);

    settings.snap_volume(0.02);
    assert!((settings.volume - 0.00).abs() < 1e-4);

    settings.snap_volume(0.98);
    assert!((settings.volume - 1.00).abs() < 1e-4);
}

#[test]
fn settings_json_roundtrip_and_missing_field_fallback() {
    let original = DungeonSettings {
        muted: true,
        volume: 0.75,
        heat: false,
        quantize: true,
        dither: false,
        scanlines: true,
        outlines: false,
        camera_zoom: 1.25,
        speedrun: true,
        haul_reveal: true,
        reader_policy: pk_core::settings_save::ReaderPolicy::Never,
    };

    let json = original.serialize_json().expect("Serialize failed");
    let recovered = DungeonSettings::deserialize_json(&json);
    assert_eq!(original, recovered);

    // Missing fields fallback to defaults
    let partial_json = r#"{"volume": 0.5, "muted": true}"#;
    let from_partial = DungeonSettings::deserialize_json(partial_json);
    assert!(from_partial.muted);
    assert_eq!(from_partial.volume, 0.5);
    assert!(from_partial.heat); // Default
    assert!(from_partial.quantize); // Default
}
