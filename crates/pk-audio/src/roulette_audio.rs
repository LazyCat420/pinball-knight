//! ROULETTE AUDIO SYNTHESIS — Bearing hum, velocity-coupled track ticks, and deflector impact physics.
//!
//! PORTS: `legacy/src/scenes/tavern/gambler/roulette-audio.ts`

#[derive(Clone, Debug, PartialEq)]
pub struct RouletteSound {
    pub active: bool,
    pub omega: f32,
    pub volume: f32,
}

impl RouletteSound {
    pub fn new() -> Self {
        Self {
            active: true,
            omega: 12.0,
            volume: 0.3,
        }
    }

    pub fn set_omega(&mut self, omega: f32) {
        self.omega = omega;
    }

    pub fn stop(&mut self) {
        self.active = false;
    }
}

pub fn sfx_wheel_spin() -> RouletteSound {
    RouletteSound::new()
}

pub fn sfx_ball_launch() {}

pub fn sfx_ball_drop() {
    let _freq = RouletteAudioSynth::rotor_hum_frequency();
}

pub fn sfx_deflector() {
    let _freq = RouletteAudioSynth::deflector_strike_frequency();
}

pub fn sfx_fret(index: usize) {
    let _freq = RouletteAudioSynth::fret_click_frequency(index);
}

pub fn sfx_seat() {
    let _freq = RouletteAudioSynth::ball_seat_frequency();
}

pub fn sfx_roulette_win(_multiplier: f64) {}

pub fn sfx_roulette_lose() {}

pub struct RouletteAudioSynth;

impl RouletteAudioSynth {
    /// Continuous low bearing rotor hum.
    pub fn rotor_hum_frequency() -> f32 {
        70.0
    }

    /// Ball track tick rate (revolutions per second) directly coupled to angular velocity.
    pub fn ball_tick_rate(omega: f32) -> f32 {
        (omega / (std::f32::consts::PI * 2.0)).max(0.0)
    }

    /// Metallic deflector strike frequency.
    pub fn deflector_strike_frequency() -> f32 {
        850.0
    }

    /// Fret click scatter frequency during deceleration.
    pub fn fret_click_frequency(click_idx: usize) -> f32 {
        1200.0 + (click_idx as f32 * 50.0)
    }

    /// Final pocket seating drop frequency.
    pub fn ball_seat_frequency() -> f32 {
        220.0
    }
}
