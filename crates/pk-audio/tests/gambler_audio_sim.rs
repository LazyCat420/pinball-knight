// Parity test suite for Gambler Slot Audio Synthesis.
// Replicates legacy/src/scenes/tavern/gambler/audio.ts

use pk_audio::gambler_audio::GamblerAudioSynth;

#[test]
fn gambler_audio_reel_stop_monotonic_frequencies() {
    let f0 = GamblerAudioSynth::reel_stop_frequency(0);
    let f1 = GamblerAudioSynth::reel_stop_frequency(1);
    let f2 = GamblerAudioSynth::reel_stop_frequency(2);

    assert!(f0 < f1, "Reel 1 frequency must exceed Reel 0");
    assert!(f1 < f2, "Reel 2 frequency must exceed Reel 1");
}

#[test]
fn gambler_audio_cues_ranges() {
    let (start, end) = GamblerAudioSynth::near_miss_riser_frequencies();
    assert!(end > start);

    let loss = GamblerAudioSynth::loss_wah_frequencies();
    assert!(loss[0] > loss[1], "Loss cue must descend in pitch");

    let jackpot = GamblerAudioSynth::jackpot_frequencies();
    assert_eq!(jackpot.len(), 4);
    assert!(jackpot[3] > jackpot[0]);
}
