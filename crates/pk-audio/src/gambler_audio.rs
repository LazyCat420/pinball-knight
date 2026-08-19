//! GAMBLER SLOT AUDIO SYNTHESIS — Procedural slot machine tone sequencing and suspense choreography.
//!
//! PORTS: `legacy/src/scenes/tavern/gambler/audio.ts`

#[derive(Clone, Debug, PartialEq)]
pub struct ReelSpin {
    pub active: bool,
    pub rate_hz: f32,
    pub volume: f32,
}

impl ReelSpin {
    pub fn new() -> Self {
        Self {
            active: true,
            rate_hz: 18.0,
            volume: 0.25,
        }
    }

    pub fn stop(&mut self) {
        self.active = false;
    }
}

pub fn sfx_lever_pull() {}

pub fn sfx_reel_spin() -> ReelSpin {
    ReelSpin::new()
}

pub fn sfx_reel_stop(index: usize) {
    let _freq = GamblerAudioSynth::reel_stop_frequency(index);
}

pub fn sfx_near_miss() {
    let (_start, _end) = GamblerAudioSynth::near_miss_riser_frequencies();
}

pub fn sfx_win_small() {}

pub fn sfx_jackpot_jingle() {
    let _freqs = GamblerAudioSynth::jackpot_frequencies();
}

pub fn sfx_lose() {
    let _freqs = GamblerAudioSynth::loss_wah_frequencies();
}

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

    pub fn click_interval(dt: f32, speed: f32) -> f32 {
        (dt * speed).max(0.01)
    }
}
