//! ROULETTE AUDIO SYNTHESIS — Bearing hum, velocity-coupled track ticks, and deflector impact physics.
//!
//! PORTS-PARTIAL: `legacy/src/scenes/tavern/gambler/roulette-audio.ts` - NOT a finished port - 50 rust code lines against 222 legacy (23%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

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
