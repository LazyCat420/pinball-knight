//! BLACKJACK AUDIO SYNTHESIS — Information-dense tactile cues and table bus control.
//!
//! PORTS-PARTIAL: `legacy/src/scenes/tavern/gambler/blackjack-audio.ts` - NOT a finished port - 52 rust code lines against 211 legacy (25%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

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
