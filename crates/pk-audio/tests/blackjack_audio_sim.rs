// Parity test suite for Blackjack Procedural Sound Engine.
// Replicates legacy/src/scenes/tavern/gambler/blackjack-audio.ts

use pk_audio::blackjack_audio::BlackjackAudioSynth;

#[test]
fn blackjack_audio_dealer_draw_and_bust_cues() {
    let f1 = BlackjackAudioSynth::dealer_draw_frequency(1);
    let f2 = BlackjackAudioSynth::dealer_draw_frequency(2);
    let f3 = BlackjackAudioSynth::dealer_draw_frequency(3);

    assert!(f1 < f2);
    assert!(f2 < f3);

    let bust = BlackjackAudioSynth::bust_thud_frequency();
    assert!(bust <= 80.0, "Bust cue must be low punch bass");

    let snap = BlackjackAudioSynth::hole_flip_snap_frequency();
    assert!(snap > bust);

    let fanfare = BlackjackAudioSynth::win_fanfare_frequencies();
    assert_eq!(fanfare.len(), 3);
}
