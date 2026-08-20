//! DARTS PROCEDURAL AUDIO — Reticle graduation metronome and 3-layer sisal impact acoustics.
//!
//! PORTS: `legacy/src/scenes/tavern/gambler/darts-audio.ts`

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StickKind {
    Board,
    Wire,
    Miss,
}

pub fn sfx_reticle_tick(stage_is_y: bool) {
    let speed = if stage_is_y { 2 } else { 1 };
    let _freq = DartsAudioSynth::reticle_tick_frequency(speed);
}

pub fn sfx_lock_axis() {
    let _freq = DartsAudioSynth::woody_knock_frequency();
}

pub fn sfx_throw() {
    let (_f1, _f2) = DartsAudioSynth::sisal_chuff_frequencies();
}

pub fn sfx_stick(kind: StickKind) {
    match kind {
        StickKind::Board => {
            let _ = DartsAudioSynth::steel_point_strike_frequency();
            let _ = DartsAudioSynth::woody_knock_frequency();
        }
        StickKind::Wire => {
            let _ = DartsAudioSynth::wire_bounce_chime_frequencies();
        }
        StickKind::Miss => {
            let _ = DartsAudioSynth::woody_knock_frequency();
        }
    }
}

pub fn sfx_bullseye() {
    let _freq = DartsAudioSynth::steel_point_strike_frequency();
}

pub fn sfx_round_end(_mult: f64) {}

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
