// Parity test suite for Darts Metronomic Audio Engine.
// Replicates legacy/src/scenes/tavern/gambler/darts-audio.ts

use pk_audio::darts_audio::DartsAudioSynth;

#[test]
fn darts_audio_reticle_metronome_and_impact_cues() {
    let t0 = DartsAudioSynth::reticle_tick_frequency(0);
    let t1 = DartsAudioSynth::reticle_tick_frequency(1);
    let t2 = DartsAudioSynth::reticle_tick_frequency(2);

    assert!(t0 < t1);
    assert!(t1 < t2);

    let (c0, c1) = DartsAudioSynth::sisal_chuff_frequencies();
    assert!(c1 > c0);

    let woody = DartsAudioSynth::woody_knock_frequency();
    assert_eq!(woody, 280.0);

    let steel = DartsAudioSynth::steel_point_strike_frequency();
    assert!(steel > woody);

    let chime = DartsAudioSynth::wire_bounce_chime_frequencies();
    assert_eq!(chime.len(), 2);
    assert!(chime[1] > chime[0]);
}
