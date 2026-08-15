// Parity test suite for Audio Category Mixer Bus.
// Replicates legacy/src/game/pinball-knight/sfx/bus.ts

use pk_audio::bus::{AudioMixerBus, SfxCategory};

#[test]
fn audio_bus_defaults_to_unity_volume_and_unmuted() {
    let bus = AudioMixerBus::new();
    assert_eq!(bus.master_volume, 1.0);
    assert!(!bus.sfx_muted);
    assert!(!bus.master_muted);

    assert_eq!(bus.effective_volume(SfxCategory::Combat), 1.0);
    assert_eq!(bus.effective_volume(SfxCategory::Pinball), 1.0);
}

#[test]
fn audio_bus_applies_category_trims() {
    let mut bus = AudioMixerBus::new();
    bus.set_category_trim(SfxCategory::Pinball, 1.5);
    bus.set_category_trim(SfxCategory::Ambience, 0.5);

    assert_eq!(bus.effective_volume(SfxCategory::Pinball), 1.5);
    assert_eq!(bus.effective_volume(SfxCategory::Ambience), 0.5);
    assert_eq!(bus.effective_volume(SfxCategory::Combat), 1.0);
}

#[test]
fn audio_bus_mutes_silence_all_categories() {
    let mut bus = AudioMixerBus::new();
    bus.set_category_trim(SfxCategory::Pinball, 1.5);

    bus.set_sfx_muted(true);
    assert_eq!(bus.effective_volume(SfxCategory::Pinball), 0.0);
    assert_eq!(bus.effective_volume(SfxCategory::Combat), 0.0);

    bus.set_sfx_muted(false);
    assert_eq!(bus.effective_volume(SfxCategory::Pinball), 1.5);

    bus.set_master_muted(true);
    assert_eq!(bus.effective_volume(SfxCategory::Pinball), 0.0);
}
