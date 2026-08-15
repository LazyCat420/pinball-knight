//! GAMBLER SLOT AUDIO SYNTHESIS — Procedural slot machine tone sequencing and suspense choreography.
//!
//! PORTS: `legacy/src/scenes/tavern/gambler/audio.ts`

pub struct GamblerAudioSynth;

impl GamblerAudioSynth {
    /// Ascending mechanical reel landing tone (Reel 0 < Reel 1 < Reel 2).
    pub fn reel_stop_frequency(reel_idx: usize) -> f32 {
        match reel_idx {
            0 => 220.0,
            1 => 277.18,
            _ => 329.63,
        }
    }

    /// Near-miss suspense riser start and end frequencies.
    pub fn near_miss_riser_frequencies() -> (f32, f32) {
        (300.0, 600.0)
    }

    /// Comic loss "wah-wah" descending pitch steps.
    pub fn loss_wah_frequencies() -> [f32; 2] {
        [260.0, 185.0]
    }

    /// Major triad jackpot victory chime frequencies.
    pub fn jackpot_frequencies() -> [f32; 4] {
        [440.0, 554.37, 659.25, 880.0]
    }
}
