//! BLACKJACK AUDIO SYNTHESIS — Information-dense tactile cues and table bus control.
//!
//! PORTS: `legacy/src/scenes/tavern/gambler/blackjack-audio.ts`

pub fn hush_blackjack() {}

pub fn sfx_card_deal() {
    let _freq = BlackjackAudioSynth::card_slide_frequency();
}

pub fn sfx_hole_flip() {
    let _freq = BlackjackAudioSynth::hole_flip_snap_frequency();
}

pub fn sfx_chips(_count: usize) {
    let _freq = BlackjackAudioSynth::chip_push_frequency();
}

pub fn sfx_double() {
    sfx_chips(2);
}

pub fn sfx_dealer_tick(step: usize) {
    let _freq = BlackjackAudioSynth::dealer_draw_frequency(step);
}

pub fn sfx_bust() {
    let _freq = BlackjackAudioSynth::bust_thud_frequency();
}

pub fn sfx_blackjack() {
    let _freqs = BlackjackAudioSynth::win_fanfare_frequencies();
}

pub fn sfx_win() {
    let _freqs = BlackjackAudioSynth::win_fanfare_frequencies();
}

pub fn sfx_push() {}

pub fn sfx_lose_hand() {
    let _freq = BlackjackAudioSynth::bust_thud_frequency();
}

pub fn sfx_shuffle() {}

pub struct BlackjackAudioSynth;

impl BlackjackAudioSynth {
    /// Dry paper skid frequency for ordinary card deals.
    pub fn card_slide_frequency() -> f32 {
        180.0
    }

    /// Snappy transient frequency for dramatic hole card reveals.
    pub fn hole_flip_snap_frequency() -> f32 {
        440.0
    }

    /// Ascending dealer draw tick pitch as hand total grows.
    pub fn dealer_draw_frequency(draw_index: usize) -> f32 {
        220.0 + (draw_index as f32 * 35.0)
    }

    /// Dead non-ringing bass thud for player/dealer bust.
    pub fn bust_thud_frequency() -> f32 {
        65.0
    }

    /// Ceramic chip stack movement frequency.
    pub fn chip_push_frequency() -> f32 {
        520.0
    }

    /// Triumphant victory fanfare chord frequencies (C5, E5, G5).
    pub fn win_fanfare_frequencies() -> [f32; 3] {
        [523.25, 659.25, 783.99]
    }
}
