//! WebAudio-shaped audio abstraction.
//!
//! The legacy `sfx/` patches (legacy/src/game/pinball-knight/sfx/) are written
//! in WebAudio vocabulary — oscillator/gain/biquad graphs with
//! `currentTime`-anchored param ramps — and every sound is synthesized (the
//! repo carries zero audio files; that is the house rule). This crate mirrors
//! that vocabulary so the patches port near-1:1:
//!
//! * native backend (M6): the `web-audio-api` crate over cpal
//! * wasm backend (M6): `web-sys` bindings to the real browser AudioContext —
//!   parity with the TS game by definition
//!
//! wasm rules carried from the TS game: unlock the context on first user
//! gesture, and schedule ahead against `current_time() + lookahead` to absorb
//! main-thread jitter.

/// The subset of the WebAudio graph the sfx patches actually use.
/// Kept minimal on purpose — grow it only when a ported patch needs a node.
pub trait AudioBackend {
    type Osc: OscillatorNode;
    type Gain: GainNode;

    fn current_time(&self) -> f64;
    fn create_oscillator(&mut self) -> Self::Osc;
    fn create_gain(&mut self) -> Self::Gain;
}

pub trait OscillatorNode {
    fn set_waveform(&mut self, wave: Waveform);
    fn frequency(&mut self) -> &mut dyn AudioParam;
    fn start(&mut self, when: f64);
    fn stop(&mut self, when: f64);
}

pub trait GainNode {
    fn gain(&mut self) -> &mut dyn AudioParam;
}

/// `AudioParam` automation — the hard part of WebAudio and the reason this
/// abstraction exists (hand-rolled mixers reimplement this badly).
pub trait AudioParam {
    fn set_value_at_time(&mut self, value: f64, when: f64);
    fn linear_ramp_to_value_at_time(&mut self, value: f64, when: f64);
    fn exponential_ramp_to_value_at_time(&mut self, value: f64, when: f64);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Waveform {
    Sine,
    Square,
    Sawtooth,
    Triangle,
}
