// Parity test suite for Roulette Procedural Sound Engine.
// Replicates legacy/src/scenes/tavern/gambler/roulette-audio.ts

use pk_audio::roulette_audio::RouletteAudioSynth;

#[test]
fn roulette_audio_ball_velocity_coupling_and_cues() {
    let tick_fast = RouletteAudioSynth::ball_tick_rate(12.566); // ~2 rev/sec
    assert!((tick_fast - 2.0).abs() < 1e-3);

    let tick_slow = RouletteAudioSynth::ball_tick_rate(3.14159); // ~0.5 rev/sec
    assert!((tick_slow - 0.5).abs() < 1e-3);

    let hum = RouletteAudioSynth::rotor_hum_frequency();
    assert_eq!(hum, 70.0);

    let deflector = RouletteAudioSynth::deflector_strike_frequency();
    assert_eq!(deflector, 850.0);

    let fret0 = RouletteAudioSynth::fret_click_frequency(0);
    let fret1 = RouletteAudioSynth::fret_click_frequency(1);
    assert!(fret1 > fret0);
}
