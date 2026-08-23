//! The two primitives every sting is built from.
//!
//! Ported from `legacy/src/game/pinball-knight/sfx/synth.ts`, node for node
//! and number for number. Written once, generic over [`AudioBackend`], so the
//! browser graph, the WASAPI graph and the software renderer all play the same
//! envelopes rather than three drifting approximations of them.
//!
//! Two details that look like noise and are not:
//!
//!  * the 8 ms attack is on EVERY beep, unconditionally. It is what stops a
//!    square wave starting mid-cycle from clicking.
//!  * the release is an EXPONENTIAL ramp to 0.001, never a linear one to 0.
//!    WebAudio exponential ramps cannot reach zero, so the curve is
//!    `v(t) = v0 * (0.001/v0)^(t/dur)`; substituting a linear release is
//!    plainly audible on the 0.07–0.09 s stings.
//!
//! PORTS: `sfx/synth.ts`

use crate::{AudioBackend, AudioParam, FilterType, Rng, Waveform};

/// One oscillator with a gain envelope and an optional exponential glide.
///
/// `at` is an offset from the context's current time, in seconds.
///
/// The argument list is the legacy `Beep` interface verbatim (type, f0, f1,
/// dur, vol, at) plus the graph it is being built into. Bundling it into a
/// struct would hide exactly the numbers the port has to stay faithful to.
#[allow(clippy::too_many_arguments)]
pub fn beep<B: AudioBackend>(
    be: &B,
    out: &B::Node,
    wave: Waveform,
    f0: f64,
    f1: Option<f64>,
    dur: f64,
    vol: f64,
    at: f64,
) {
    let t = be.current_time() + at;

    let osc = be.create_oscillator(wave);
    let freq = be.frequency(&osc);
    freq.set_value_at_time(f0, t);
    if let Some(f1) = f1 {
        // `max(f1, 1)`: an exponential ramp through zero is undefined, and the
        // legacy code clamps rather than special-cases it.
        freq.exponential_ramp_to_value_at_time(f1.max(1.0), t + dur);
    }

    let g = be.create_gain();
    let gain = be.gain(&g);
    gain.set_value_at_time(0.0, t);
    gain.linear_ramp_to_value_at_time(vol, t + 0.008);
    gain.exponential_ramp_to_value_at_time(0.001, t + dur);

    be.connect(&osc, &g);
    be.connect(&g, out);
    be.start(&osc, t);
    // +0.02 so the stop lands after the release has arrived at 0.001 rather
    // than truncating it into a click.
    be.stop(&osc, t + dur + 0.02);
}

/// A filtered white-noise burst — every percussive, breathy or gritty sound.
///
/// The biquad's Q is left at the spec default of 1.0; only the anvil strike
/// asks for a different one, and it builds its own node.
#[allow(clippy::too_many_arguments)]
pub fn burst<B: AudioBackend>(
    be: &B,
    out: &B::Node,
    rng: &mut Rng,
    dur: f64,
    vol: f64,
    kind: FilterType,
    freq: f64,
    at: f64,
) {
    let t = be.current_time() + at;
    let len = ((be.sample_rate() as f64 * dur).floor() as usize).max(1);
    let mut data = vec![0.0f32; len];
    for s in data.iter_mut() {
        *s = rng.unit();
    }
    noise_through(be, out, &data, kind, freq, None, vol, t, dur, false);
}

/// The anvil strike's noise layer: the same chain as [`burst`], but with the
/// decay baked into the SAMPLES (`(1 - i/len)`) and an explicit Q.
///
/// It is a separate entry point rather than a flag on `burst` because the
/// legacy anvil builds its buffer by hand for exactly this reason — a gain
/// envelope alone gives you a filtered hiss, not a strike.
#[allow(clippy::too_many_arguments)]
pub fn decaying_burst<B: AudioBackend>(
    be: &B,
    out: &B::Node,
    rng: &mut Rng,
    dur: f64,
    vol: f64,
    kind: FilterType,
    freq: f64,
    q: Option<f64>,
    at: f64,
) {
    let t = be.current_time() + at;
    let len = ((be.sample_rate() as f64 * dur).floor() as usize).max(1);
    let mut data = vec![0.0f32; len];
    for (i, s) in data.iter_mut().enumerate() {
        *s = rng.unit() * (1.0 - i as f32 / len as f32);
    }
    noise_through(be, out, &data, kind, freq, q, vol, t, dur, false);
}

/// Shared tail of both noise primitives: source → biquad → gain → `out`, with
/// the `vol → 0.001` exponential release.
#[allow(clippy::too_many_arguments)]
fn noise_through<B: AudioBackend>(
    be: &B,
    out: &B::Node,
    data: &[f32],
    kind: FilterType,
    freq: f64,
    q: Option<f64>,
    vol: f64,
    t: f64,
    dur: f64,
    looping: bool,
) {
    let src = be.create_buffer_source(data, looping);
    let filter = be.create_biquad(kind, freq, q);
    let g = be.create_gain();
    let gain = be.gain(&g);
    gain.set_value_at_time(vol, t);
    gain.exponential_ramp_to_value_at_time(0.001, t + dur);

    be.connect(&src, &filter);
    be.connect(&filter, &g);
    be.connect(&g, out);
    be.start(&src, t);
    be.stop(&src, t + dur);
}
