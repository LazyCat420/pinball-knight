// Parity test suite for Audio Tuning Constants.
// Replicates legacy/src/game/pinball-knight/constants/audio.ts

use pk_core::constants::audio::VOLUME_STEPS;

#[test]
fn audio_volume_steps_matches_ten_notches() {
    assert_eq!(VOLUME_STEPS, 10);

    for step in 0..=VOLUME_STEPS {
        let frac = step as f32 / VOLUME_STEPS as f32;
        assert!(frac >= 0.0 && frac <= 1.0);
    }
}
