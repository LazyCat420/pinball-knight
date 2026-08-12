//! The Windows device tier, over the `web-audio-api` crate (a spec-faithful
//! Rust WebAudio on cpal, reaching WASAPI).
//!
//! Windows-only ON PURPOSE — see the crate docs. `scripts/pk-win.sh` is the
//! play target, cpal's Windows backend needs no system headers, and the
//! `x86_64-pc-windows-gnullvm` cross-link of the whole cpal/WASAPI chain under
//! llvm-mingw is verified working. Linux runs the software tier instead.
//!
//! ── EVERY HANDLE IS Arc<Mutex<…>> ───────────────────────────────────────────
//! Two reasons, both structural. (1) `connect` wants one uniform handle type
//! and `web-audio-api` has a distinct type per node kind, so they live behind
//! one `Slot` enum. (2) `set_type`/`start_at`/`stop_at`/`set_buffer` all take
//! `&mut self`, while [`crate::AudioBackend`] is a `&self` API because the
//! `Sfx` handle is a shared Bevy resource. The `Mutex` also means the backend
//! only needs its nodes to be `Send`, not `Sync`, to be a plain Bevy resource.
//!
//! ── NEVER PANIC ─────────────────────────────────────────────────────────────
//! `start_at` panics if a source was already started and `stop_at` panics if it
//! was never started, so both are latched here. A double-`stop` on the tavern
//! bed (leave the room twice in a frame) must be a no-op, not a crash inside
//! the render loop.
//!
//! PORTS-NOTHING — native backend (web-audio-api crate) — the browser half is web.rs

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use web_audio_api::context::{AudioContext, BaseAudioContext};
use web_audio_api::node::{
    AudioBufferSourceNode, AudioDestinationNode, AudioNode, AudioScheduledSourceNode,
    BiquadFilterNode, BiquadFilterType, GainNode, OscillatorNode, OscillatorType,
};

use crate::{AudioBackend, FilterType, Waveform};

enum Slot {
    Osc(OscillatorNode),
    Gain(GainNode),
    Biquad(BiquadFilterNode),
    Source(AudioBufferSourceNode),
    Dest(AudioDestinationNode),
}

impl Slot {
    fn as_node(&self) -> &dyn AudioNode {
        match self {
            Slot::Osc(n) => n,
            Slot::Gain(n) => n,
            Slot::Biquad(n) => n,
            Slot::Source(n) => n,
            Slot::Dest(n) => n,
        }
    }

    /// Slot 0 is the node's primary param (gain, or frequency); slot 1 is a
    /// biquad's Q. Nodes without one answer `None`.
    fn param(&self, which: usize) -> Option<&web_audio_api::AudioParam> {
        match self {
            Slot::Osc(n) => Some(n.frequency()),
            Slot::Gain(n) => Some(n.gain()),
            Slot::Biquad(n) => Some(if which == 1 { n.q() } else { n.frequency() }),
            _ => None,
        }
    }
}

struct Cell {
    slot: Mutex<Slot>,
    started: AtomicBool,
    stopped: AtomicBool,
}

#[derive(Clone)]
pub struct NativeNode(Arc<Cell>);

#[derive(Clone)]
pub struct NativeParam {
    cell: Arc<Cell>,
    which: usize,
}

pub struct NativeBackend {
    ctx: AudioContext,
    dest: NativeNode,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn cell(slot: Slot) -> NativeNode {
    NativeNode(Arc::new(Cell {
        slot: Mutex::new(slot),
        started: AtomicBool::new(false),
        stopped: AtomicBool::new(false),
    }))
}

impl NativeBackend {
    /// Open the device. `None` (never a panic) means "no audio" — a box with
    /// no output device is a normal state, not an error the game handles.
    pub fn live() -> Option<NativeBackend> {
        let ctx = std::panic::catch_unwind(AudioContext::default).ok()?;
        let dest = cell(Slot::Dest(ctx.destination()));
        Some(NativeBackend { ctx, dest })
    }
}

impl AudioBackend for NativeBackend {
    type Node = NativeNode;
    type Param = NativeParam;

    fn current_time(&self) -> f64 {
        self.ctx.current_time()
    }

    fn sample_rate(&self) -> f32 {
        self.ctx.sample_rate()
    }

    fn destination(&self) -> NativeNode {
        self.dest.clone()
    }

    fn create_oscillator(&self, wave: Waveform) -> NativeNode {
        let mut osc = self.ctx.create_oscillator();
        osc.set_type(match wave {
            Waveform::Sine => OscillatorType::Sine,
            Waveform::Square => OscillatorType::Square,
            Waveform::Sawtooth => OscillatorType::Sawtooth,
            Waveform::Triangle => OscillatorType::Triangle,
        });
        cell(Slot::Osc(osc))
    }

    fn create_gain(&self) -> NativeNode {
        cell(Slot::Gain(self.ctx.create_gain()))
    }

    fn create_biquad(&self, kind: FilterType, freq: f64, q: Option<f64>) -> NativeNode {
        let mut f = self.ctx.create_biquad_filter();
        f.set_type(match kind {
            FilterType::Lowpass => BiquadFilterType::Lowpass,
            FilterType::Highpass => BiquadFilterType::Highpass,
            FilterType::Bandpass => BiquadFilterType::Bandpass,
        });
        f.frequency().set_value(freq as f32);
        if let Some(q) = q {
            f.q().set_value(q as f32);
        }
        cell(Slot::Biquad(f))
    }

    fn create_buffer_source(&self, data: &[f32], looping: bool) -> NativeNode {
        let mut buf = self
            .ctx
            .create_buffer(1, data.len().max(1), self.ctx.sample_rate());
        buf.copy_to_channel(data, 0);
        let mut src = self.ctx.create_buffer_source();
        src.set_buffer(buf);
        src.set_loop(looping);
        cell(Slot::Source(src))
    }

    fn connect(&self, src: &NativeNode, dst: &NativeNode) {
        let s = lock(&src.0.slot);
        let d = lock(&dst.0.slot);
        s.as_node().connect(d.as_node());
    }

    fn connect_param(&self, src: &NativeNode, dst: &NativeParam) {
        let s = lock(&src.0.slot);
        let d = lock(&dst.cell.slot);
        if let Some(p) = d.param(dst.which) {
            s.as_node().connect(p);
        }
    }

    fn gain(&self, node: &NativeNode) -> NativeParam {
        NativeParam {
            cell: Arc::clone(&node.0),
            which: 0,
        }
    }

    fn frequency(&self, node: &NativeNode) -> NativeParam {
        NativeParam {
            cell: Arc::clone(&node.0),
            which: 0,
        }
    }

    fn start(&self, node: &NativeNode, when: f64) {
        if node.0.started.swap(true, Ordering::SeqCst) {
            return;
        }
        match &mut *lock(&node.0.slot) {
            Slot::Osc(n) => n.start_at(when),
            Slot::Source(n) => n.start_at(when),
            _ => {}
        }
    }

    fn stop(&self, node: &NativeNode, when: f64) {
        // A stop before the start would panic inside `web-audio-api`; a source
        // that was never started simply has nothing to stop.
        if !node.0.started.load(Ordering::SeqCst) || node.0.stopped.swap(true, Ordering::SeqCst) {
            return;
        }
        match &mut *lock(&node.0.slot) {
            Slot::Osc(n) => n.stop_at(when),
            Slot::Source(n) => n.stop_at(when),
            _ => {}
        }
    }
}

impl crate::AudioParam for NativeParam {
    fn set_value(&self, value: f64) {
        self.with(|p| {
            p.set_value(value as f32);
        });
    }

    fn value(&self) -> f64 {
        self.with(|p| p.value() as f64).unwrap_or(0.0)
    }

    fn set_value_at_time(&self, value: f64, when: f64) {
        self.with(|p| {
            p.set_value_at_time(value as f32, when);
        });
    }

    fn linear_ramp_to_value_at_time(&self, value: f64, when: f64) {
        self.with(|p| {
            p.linear_ramp_to_value_at_time(value as f32, when);
        });
    }

    fn exponential_ramp_to_value_at_time(&self, value: f64, when: f64) {
        self.with(|p| {
            p.exponential_ramp_to_value_at_time(value as f32, when);
        });
    }

    fn cancel_scheduled_values(&self, when: f64) {
        self.with(|p| {
            p.cancel_scheduled_values(when);
        });
    }
}

impl NativeParam {
    fn with<R>(&self, f: impl FnOnce(&web_audio_api::AudioParam) -> R) -> Option<R> {
        let slot = lock(&self.cell.slot);
        slot.param(self.which).map(f)
    }
}

/// `Sfx` is a plain Bevy resource, which means the whole graph has to be
/// `Send + Sync`. `Mutex<Slot>` covers `Sync` as long as the nodes are `Send`;
/// this is the compile-time proof that they are, so a `web-audio-api` bump
/// that changes it fails HERE and not at the resource insertion in pk-game.
const _: fn() = || {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<NativeBackend>();
    assert_send_sync::<NativeNode>();
    assert_send_sync::<NativeParam>();
};
