//! DARTS PROCEDURAL AUDIO — Reticle graduation metronome and 3-layer sisal impact acoustics.
//!
//! PORTS: `legacy/src/scenes/tavern/gambler/darts-audio.ts`

pub struct DartsAudioSynth;

impl DartsAudioSynth {
    /// Reticle graduation tick metronome pitch (escalates with speed level).
    pub fn reticle_tick_frequency(speed_level: usize) -> f32 {
        600.0 + (speed_level as f32 * 80.0)
    }

    /// Sisal fiber friction noise filter range (start, end).
    pub fn sisal_chuff_frequencies() -> (f32, f32) {
        (700.0, 900.0)
    }

    /// Woody knock backing body frequency.
    pub fn woody_knock_frequency() -> f32 {
        280.0
    }

    /// High steel point strike ping frequency.
    pub fn steel_point_strike_frequency() -> f32 {
        1450.0
    }

    /// Metallic wire bounce-out deflection chime.
    pub fn wire_bounce_chime_frequencies() -> [f32; 2] {
        [1800.0, 2200.0]
    }
}
