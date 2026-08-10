//! Native backend over the `web-audio-api` crate (spec-faithful WebAudio on
//! cpal). This file starts life as the gnullvm COMPILE PROBE: constructing a
//! context and touching the node types is enough to force the whole
//! cpal/WASAPI dependency chain through the cross linker before any patch
//! code is written against it.

use web_audio_api::context::{AudioContext, BaseAudioContext};
use web_audio_api::node::{AudioNode, AudioScheduledSourceNode};

/// Build a live output context. Fail-silent contract lives one layer up —
/// callers treat `Err` as "no audio", never a panic.
pub fn try_context() -> Option<AudioContext> {
    std::panic::catch_unwind(AudioContext::default).ok()
}

/// Probe helper: schedule a zero-gain beep so the full osc→gain→destination
/// path type-checks and links. Not called in the game loop.
pub fn probe_graph(ctx: &AudioContext) {
    let t = ctx.current_time();
    let osc = ctx.create_oscillator();
    let gain = ctx.create_gain();
    gain.gain().set_value_at_time(0.0, t);
    osc.connect(&gain);
    gain.connect(&ctx.destination());
    let mut osc = osc;
    osc.start_at(t);
    osc.stop_at(t + 0.01);
}
