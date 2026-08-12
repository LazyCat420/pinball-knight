//! The browser tier — `web-sys` bindings to the real `AudioContext`.
//!
//! Parity with the TS game by definition: this is the same graph, on the same
//! engine, that `legacy/src/scenes/tavern/audio.ts` drives today.
//!
//! ── NOT `Send`, AND THAT IS THE POINT ───────────────────────────────────────
//! Every handle here is a JS object, so none of it can cross a thread and none
//! of it can be a Bevy resource — Bevy 0.17 dropped `!Send` resources. The
//! context therefore lives in a `thread_local!` owned by `lib.rs`, and the
//! resource holds a zero-sized marker. wasm is single-threaded, so this costs
//! nothing and is the only shape that compiles.
//!
//! ── THE GESTURE UNLOCK ──────────────────────────────────────────────────────
//! Browsers start the context `suspended` until a user gesture. `resume()` is
//! called from the first key or click (see `pk-game/src/sfx.rs`) and is safe to
//! call repeatedly — a resumed context resolves immediately. Anything
//! scheduled before the unlock is simply inaudible, which is why the bed has
//! no error path: not making a sound on the first visit is legitimate.
//!
//! ── NOTHING HERE CAN THROW ──────────────────────────────────────────────────
//! Every `Result` from the bindings degrades to [`WebNode::Null`] / an empty
//! [`WebParam`], which every later call no-ops on. A context torn down
//! mid-frame (a browser reclaiming it, a hostile embed) must go quiet, not
//! unwind into whatever the game loop was doing.
//!
//! PORTS: `legacy/src/scenes/tavern/audio.ts`

use web_sys::{
    AudioBufferSourceNode, AudioContext, AudioNode, AudioParam as JsParam, BiquadFilterNode,
    BiquadFilterType, GainNode, OscillatorNode, OscillatorType,
};

use crate::{AudioBackend, FilterType, Waveform};

/// One uniform handle. The concrete node is kept (rather than the erased
/// `AudioNode`) because `set_loop` / `start_with_when` only exist on it.
#[derive(Clone)]
pub enum WebNode {
    Osc(OscillatorNode),
    Gain(GainNode),
    Biquad(BiquadFilterNode),
    Source(AudioBufferSourceNode),
    Dest(web_sys::AudioDestinationNode),
    /// The context refused to build this node. Inert.
    Null,
}

impl WebNode {
    fn as_node(&self) -> Option<&AudioNode> {
        match self {
            WebNode::Osc(n) => Some(n.as_ref()),
            WebNode::Gain(n) => Some(n.as_ref()),
            WebNode::Biquad(n) => Some(n.as_ref()),
            WebNode::Source(n) => Some(n.as_ref()),
            WebNode::Dest(n) => Some(n.as_ref()),
            WebNode::Null => None,
        }
    }
}

/// `None` is a param that was never built — every automation call on it is a
/// no-op and `value()` reads 0.
#[derive(Clone)]
pub struct WebParam(Option<JsParam>);

pub struct WebBackend {
    ctx: AudioContext,
}

impl WebBackend {
    /// `None` means the browser refused a context — stay silent.
    pub fn live() -> Option<WebBackend> {
        AudioContext::new().ok().map(|ctx| WebBackend { ctx })
    }
}

impl AudioBackend for WebBackend {
    type Node = WebNode;
    type Param = WebParam;

    fn current_time(&self) -> f64 {
        self.ctx.current_time()
    }

    fn sample_rate(&self) -> f32 {
        self.ctx.sample_rate()
    }

    fn destination(&self) -> WebNode {
        WebNode::Dest(self.ctx.destination())
    }

    fn create_oscillator(&self, wave: Waveform) -> WebNode {
        match self.ctx.create_oscillator() {
            Ok(osc) => {
                osc.set_type(match wave {
                    Waveform::Sine => OscillatorType::Sine,
                    Waveform::Square => OscillatorType::Square,
                    Waveform::Sawtooth => OscillatorType::Sawtooth,
                    Waveform::Triangle => OscillatorType::Triangle,
                });
                WebNode::Osc(osc)
            }
            Err(_) => WebNode::Null,
        }
    }

    fn create_gain(&self) -> WebNode {
        match self.ctx.create_gain() {
            Ok(g) => WebNode::Gain(g),
            Err(_) => WebNode::Null,
        }
    }

    fn create_biquad(&self, kind: FilterType, freq: f64, q: Option<f64>) -> WebNode {
        let Ok(f) = self.ctx.create_biquad_filter() else {
            return WebNode::Null;
        };
        f.set_type(match kind {
            FilterType::Lowpass => BiquadFilterType::Lowpass,
            FilterType::Highpass => BiquadFilterType::Highpass,
            FilterType::Bandpass => BiquadFilterType::Bandpass,
        });
        f.frequency().set_value(freq as f32);
        if let Some(q) = q {
            f.q().set_value(q as f32);
        }
        WebNode::Biquad(f)
    }

    fn create_buffer_source(&self, data: &[f32], looping: bool) -> WebNode {
        let Ok(src) = self.ctx.create_buffer_source() else {
            return WebNode::Null;
        };
        let len = data.len().max(1) as u32;
        if let Ok(buf) = self.ctx.create_buffer(1, len, self.ctx.sample_rate()) {
            let _ = buf.copy_to_channel(data, 0);
            src.set_buffer(Some(&buf));
        }
        src.set_loop(looping);
        WebNode::Source(src)
    }

    fn connect(&self, src: &WebNode, dst: &WebNode) {
        if let (Some(s), Some(d)) = (src.as_node(), dst.as_node()) {
            let _ = s.connect_with_audio_node(d);
        }
    }

    fn connect_param(&self, src: &WebNode, dst: &WebParam) {
        if let (Some(s), Some(p)) = (src.as_node(), dst.0.as_ref()) {
            let _ = s.connect_with_audio_param(p);
        }
    }

    fn gain(&self, node: &WebNode) -> WebParam {
        WebParam(match node {
            WebNode::Gain(g) => Some(g.gain()),
            _ => None,
        })
    }

    fn frequency(&self, node: &WebNode) -> WebParam {
        WebParam(match node {
            WebNode::Osc(o) => Some(o.frequency()),
            WebNode::Biquad(b) => Some(b.frequency()),
            _ => None,
        })
    }

    fn start(&self, node: &WebNode, when: f64) {
        match node {
            WebNode::Osc(n) => {
                let _ = n.start_with_when(when);
            }
            WebNode::Source(n) => {
                let _ = n.start_with_when(when);
            }
            _ => {}
        }
    }

    fn stop(&self, node: &WebNode, when: f64) {
        match node {
            WebNode::Osc(n) => {
                let _ = n.stop_with_when(when);
            }
            WebNode::Source(n) => {
                // Through the base class: web-sys deprecates the copy
                // `AudioBufferSourceNode` inherits, and the buffer source's
                // own `start` overloads are the only reason it has any.
                let base: &web_sys::AudioScheduledSourceNode = n.as_ref();
                let _ = base.stop_with_when(when);
            }
            _ => {}
        }
    }

    fn resume(&self) {
        // The returned promise is deliberately dropped: nothing downstream
        // waits on the unlock, and anything scheduled before it lands was
        // going to be inaudible either way.
        let _ = self.ctx.resume();
    }
}

impl crate::AudioParam for WebParam {
    fn set_value(&self, value: f64) {
        if let Some(p) = &self.0 {
            p.set_value(value as f32);
        }
    }

    fn value(&self) -> f64 {
        self.0.as_ref().map(|p| p.value() as f64).unwrap_or(0.0)
    }

    fn set_value_at_time(&self, value: f64, when: f64) {
        if let Some(p) = &self.0 {
            let _ = p.set_value_at_time(value as f32, when);
        }
    }

    fn linear_ramp_to_value_at_time(&self, value: f64, when: f64) {
        if let Some(p) = &self.0 {
            let _ = p.linear_ramp_to_value_at_time(value as f32, when);
        }
    }

    fn exponential_ramp_to_value_at_time(&self, value: f64, when: f64) {
        if let Some(p) = &self.0 {
            let _ = p.exponential_ramp_to_value_at_time(value as f32, when);
        }
    }

    fn cancel_scheduled_values(&self, when: f64) {
        if let Some(p) = &self.0 {
            let _ = p.cancel_scheduled_values(when);
        }
    }
}
