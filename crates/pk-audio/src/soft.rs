//! A dependency-free software WebAudio graph.
//!
//! ── WHY IT EXISTS ────────────────────────────────────────────────────────────
//! Two jobs, one implementation:
//!
//!  1. **The offline oracle.** `tests/render.rs` has to assert what the patches
//!     actually SOUND like — peak, RMS, a fade that rises — and it has to do
//!     that in CI, on a box with no audio device and no system audio headers.
//!     Nothing that opens a device can do that.
//!  2. **The Linux tier.** `web-audio-api` drags in cpal, cpal's Linux backend
//!     needs the ALSA dev headers, and the dev box has neither the headers nor
//!     the sudo to install them — a hard dependency there breaks `cargo check`
//!     for the whole workspace. Linux gets this instead: the same graph, the
//!     same envelopes, [`Mode::Silent`] (no device, nothing rendered).
//!
//! In `Silent` mode nodes are NOT stored at all — the id counter advances, every
//! handle is inert, and memory does not grow across a session. Only the clock is
//! real, which is all the coin ladder and the bumper limiter need.
//!
//! ── FIDELITY, HONESTLY ───────────────────────────────────────────────────────
//! Param automation is exact — including the exponential curve
//! `v0 * (v1/v0)^(x/dur)`, which is the one thing a hand-rolled mixer always
//! gets wrong. The oscillators are NAIVE (not band-limited like a real
//! `PeriodicWave`), so a square or saw here has alias partials the browser
//! would not produce; and biquad coefficients are recomputed per 128-sample
//! block rather than per sample, which is inaudible for the one modulated
//! cutoff we have (a 0.23 Hz LFO). Neither affects the envelope and level
//! assertions this renderer exists to make.
//!
//! PORTS-NOTHING — offline software renderer, so tests need no audio device. No TS counterpart

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Instant;

use crate::{AudioBackend, AudioParam, FilterType, Waveform};

/// The WebAudio render quantum.
const BLOCK: usize = 128;

/// How the clock advances, and whether anything is kept.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// Wall-clock time, no graph, no output. The Linux live tier.
    Silent,
    /// Time advances only in [`SoftBackend::render_seconds`]. The test tier.
    Offline,
}

#[derive(Clone)]
pub struct SoftBackend {
    g: Arc<Mutex<Graph>>,
}

/// A node is nothing but its id — every operation goes through the backend
/// that owns the graph, so the handle carries no reference of its own.
#[derive(Clone, Copy)]
pub struct SoftNode {
    id: u64,
}

#[derive(Clone)]
pub struct SoftParam {
    g: Arc<Mutex<Graph>>,
    id: u64,
    slot: usize,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl SoftBackend {
    /// The live Linux tier: a real clock, an inert graph.
    pub fn live() -> Option<SoftBackend> {
        Some(SoftBackend::with(Mode::Silent, 44_100.0))
    }

    /// The test tier: a clock you drive by rendering.
    pub fn offline(sample_rate: f32) -> SoftBackend {
        SoftBackend::with(Mode::Offline, sample_rate)
    }

    fn with(mode: Mode, sample_rate: f32) -> SoftBackend {
        SoftBackend {
            g: Arc::new(Mutex::new(Graph::new(mode, sample_rate))),
        }
    }

    /// Advance the clock by `secs` and return every sample produced. Silent
    /// mode renders nothing (there is no graph to render).
    pub fn render_seconds(&self, secs: f64) -> Vec<f32> {
        let mut g = lock(&self.g);
        if g.mode != Mode::Offline {
            return Vec::new();
        }
        let frames = (secs * g.sample_rate as f64).round().max(0.0) as usize;
        g.render(frames)
    }

    fn add(&self, kind: Kind, params: [Param; 2]) -> SoftNode {
        SoftNode {
            id: lock(&self.g).add(kind, params),
        }
    }

    fn param(&self, node: &SoftNode, slot: usize) -> SoftParam {
        SoftParam {
            g: Arc::clone(&self.g),
            id: node.id,
            slot,
        }
    }
}

impl AudioBackend for SoftBackend {
    type Node = SoftNode;
    type Param = SoftParam;

    fn current_time(&self) -> f64 {
        lock(&self.g).current_time()
    }

    fn sample_rate(&self) -> f32 {
        lock(&self.g).sample_rate
    }

    fn destination(&self) -> SoftNode {
        SoftNode {
            id: lock(&self.g).dest,
        }
    }

    fn create_oscillator(&self, wave: Waveform) -> SoftNode {
        self.add(Kind::Osc(wave), [Param::new(440.0), Param::new(0.0)])
    }

    fn create_gain(&self) -> SoftNode {
        self.add(Kind::Gain, [Param::new(1.0), Param::new(0.0)])
    }

    fn create_biquad(&self, kind: FilterType, freq: f64, q: Option<f64>) -> SoftNode {
        self.add(
            Kind::Biquad(kind),
            [Param::new(freq), Param::new(q.unwrap_or(1.0))],
        )
    }

    fn create_buffer_source(&self, data: &[f32], looping: bool) -> SoftNode {
        // Silent mode never renders, so do not pay for (or hold) the samples.
        let data = if lock(&self.g).mode == Mode::Offline {
            Arc::new(data.to_vec())
        } else {
            Arc::new(Vec::new())
        };
        self.add(
            Kind::Source { data, looping },
            [Param::new(0.0), Param::new(0.0)],
        )
    }

    fn connect(&self, src: &SoftNode, dst: &SoftNode) {
        lock(&self.g).connect(src.id, dst.id, None);
    }

    fn connect_param(&self, src: &SoftNode, dst: &SoftParam) {
        lock(&self.g).connect(src.id, dst.id, Some(dst.slot));
    }

    fn gain(&self, node: &SoftNode) -> SoftParam {
        self.param(node, 0)
    }

    fn frequency(&self, node: &SoftNode) -> SoftParam {
        self.param(node, 0)
    }

    fn start(&self, node: &SoftNode, when: f64) {
        if let Some(n) = lock(&self.g).nodes.get_mut(&node.id) {
            n.start = Some(when);
        }
    }

    fn stop(&self, node: &SoftNode, when: f64) {
        if let Some(n) = lock(&self.g).nodes.get_mut(&node.id) {
            n.stop = Some(when);
        }
    }
}

impl AudioParam for SoftParam {
    fn set_value(&self, value: f64) {
        self.edit(|p| p.value = value);
    }

    fn value(&self) -> f64 {
        let g = lock(&self.g);
        let t = g.current_time();
        g.nodes
            .get(&self.id)
            .map(|n| n.params[self.slot].at(t))
            .unwrap_or(0.0)
    }

    fn set_value_at_time(&self, value: f64, when: f64) {
        self.edit(|p| p.push(PEvent::new(when, value, Curve::Set)));
    }

    fn linear_ramp_to_value_at_time(&self, value: f64, when: f64) {
        self.edit(|p| p.push(PEvent::new(when, value, Curve::Linear)));
    }

    fn exponential_ramp_to_value_at_time(&self, value: f64, when: f64) {
        self.edit(|p| p.push(PEvent::new(when, value, Curve::Exponential)));
    }

    fn cancel_scheduled_values(&self, when: f64) {
        self.edit(|p| p.events.retain(|e| e.t < when));
    }
}

impl SoftParam {
    fn edit(&self, f: impl FnOnce(&mut Param)) {
        let mut g = lock(&self.g);
        if let Some(n) = g.nodes.get_mut(&self.id) {
            f(&mut n.params[self.slot]);
        }
    }
}

// ── The graph ───────────────────────────────────────────────────────────────

#[derive(Clone)]
enum Kind {
    Osc(Waveform),
    Gain,
    Biquad(FilterType),
    Source { data: Arc<Vec<f32>>, looping: bool },
    Dest,
}

#[derive(Debug, Clone, Copy)]
struct Edge {
    to: u64,
    /// `None` = audio input, `Some(slot)` = modulation of that param.
    param: Option<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Curve {
    Set,
    Linear,
    Exponential,
}

#[derive(Debug, Clone, Copy)]
struct PEvent {
    t: f64,
    v: f64,
    curve: Curve,
}

impl PEvent {
    fn new(t: f64, v: f64, curve: Curve) -> PEvent {
        PEvent { t, v, curve }
    }
}

/// One automatable parameter: an intrinsic value, a sorted event list, and the
/// per-block accumulator every signal connected INTO it sums through.
struct Param {
    value: f64,
    events: Vec<PEvent>,
    modulation: Vec<f32>,
}

impl Param {
    fn new(value: f64) -> Param {
        Param {
            value,
            events: Vec::new(),
            modulation: vec![0.0; BLOCK],
        }
    }

    fn push(&mut self, e: PEvent) {
        let at = self.events.partition_point(|x| x.t <= e.t);
        self.events.insert(at, e);
    }

    /// The intrinsic value at `t`, interpolating whichever curve is in flight.
    ///
    /// This is the whole point of the module. `Set` holds; `Linear` lerps from
    /// the previous event; `Exponential` follows `v0 * (v1/v0)^(x/dur)` — the
    /// curve that never reaches zero, which is why every release in the patch
    /// set targets 0.001 instead of 0.
    fn at(&self, t: f64) -> f64 {
        if self.events.is_empty() {
            return self.value;
        }
        let idx = self.events.partition_point(|e| e.t <= t);
        if idx == 0 {
            // Before the first event the param holds its intrinsic value.
            return self.value;
        }
        let anchor = self.events[idx - 1];
        let Some(next) = self.events.get(idx) else {
            return anchor.v;
        };
        let span = next.t - anchor.t;
        if span <= 0.0 {
            return next.v;
        }
        let x = ((t - anchor.t) / span).clamp(0.0, 1.0);
        match next.curve {
            Curve::Set => anchor.v,
            Curve::Linear => anchor.v + (next.v - anchor.v) * x,
            Curve::Exponential => {
                // An exponential through or from zero is undefined; WebAudio
                // treats it as a hold rather than producing a NaN.
                if anchor.v <= 0.0 || next.v <= 0.0 {
                    anchor.v
                } else {
                    anchor.v * (next.v / anchor.v).powf(x)
                }
            }
        }
    }
}

struct Node {
    kind: Kind,
    params: [Param; 2],
    outs: Vec<Edge>,
    start: Option<f64>,
    stop: Option<f64>,
    phase: f64,
    pos: usize,
    /// Direct-form-I biquad state: x[n-1], x[n-2], y[n-1], y[n-2].
    z: [f64; 4],
    input: Vec<f32>,
    output: Vec<f32>,
}

impl Node {
    fn new(kind: Kind, params: [Param; 2]) -> Node {
        Node {
            kind,
            params,
            outs: Vec::new(),
            start: None,
            stop: None,
            phase: 0.0,
            pos: 0,
            z: [0.0; 4],
            input: vec![0.0; BLOCK],
            output: vec![0.0; BLOCK],
        }
    }

    fn playing(&self, t: f64) -> bool {
        self.start.is_some_and(|s| t >= s) && self.stop.is_none_or(|e| t < e)
    }

    fn render(&mut self, n: usize, t0: f64, sr: f64) {
        let dt = 1.0 / sr;
        let kind = self.kind.clone();
        match kind {
            Kind::Osc(wave) => {
                for i in 0..n {
                    let t = t0 + i as f64 * dt;
                    if !self.playing(t) {
                        self.output[i] = 0.0;
                        continue;
                    }
                    let f = self.params[0].at(t) + self.params[0].modulation[i] as f64;
                    self.output[i] = wave_sample(wave, self.phase) as f32;
                    self.phase = (self.phase + f * dt).rem_euclid(1.0);
                }
            }
            Kind::Gain => {
                for i in 0..n {
                    let t = t0 + i as f64 * dt;
                    let g = self.params[0].at(t) + self.params[0].modulation[i] as f64;
                    self.output[i] = self.input[i] * g as f32;
                }
            }
            Kind::Biquad(ft) => {
                let f = (self.params[0].at(t0) + self.params[0].modulation[0] as f64)
                    .clamp(10.0, sr * 0.5 - 100.0);
                let q = self.params[1].at(t0);
                let (b, a) = biquad(ft, f, q, sr);
                for i in 0..n {
                    let x = self.input[i] as f64;
                    let y = b[0] * x + b[1] * self.z[0] + b[2] * self.z[1]
                        - a[0] * self.z[2]
                        - a[1] * self.z[3];
                    self.z[1] = self.z[0];
                    self.z[0] = x;
                    self.z[3] = self.z[2];
                    self.z[2] = y;
                    self.output[i] = y as f32;
                }
            }
            Kind::Source { data, looping } => {
                for i in 0..n {
                    let t = t0 + i as f64 * dt;
                    if !self.playing(t) || data.is_empty() {
                        self.output[i] = 0.0;
                        continue;
                    }
                    if self.pos >= data.len() {
                        if looping {
                            self.pos = 0;
                        } else {
                            self.output[i] = 0.0;
                            continue;
                        }
                    }
                    self.output[i] = data[self.pos];
                    self.pos += 1;
                }
            }
            // The destination is read from its INPUT accumulator; it produces
            // nothing of its own.
            Kind::Dest => {}
        }
    }
}

struct Graph {
    mode: Mode,
    sample_rate: f32,
    started: Instant,
    frames: u64,
    next_id: u64,
    dest: u64,
    /// Creation order — the deterministic fallback if the topological sort
    /// ever meets a cycle.
    order: Vec<u64>,
    nodes: HashMap<u64, Node>,
}

impl Graph {
    fn new(mode: Mode, sample_rate: f32) -> Graph {
        let mut g = Graph {
            mode,
            sample_rate: if sample_rate > 0.0 {
                sample_rate
            } else {
                44_100.0
            },
            started: Instant::now(),
            frames: 0,
            next_id: 0,
            dest: 0,
            order: Vec::new(),
            nodes: HashMap::new(),
        };
        g.dest = g.add(Kind::Dest, [Param::new(0.0), Param::new(0.0)]);
        g
    }

    fn current_time(&self) -> f64 {
        match self.mode {
            Mode::Silent => self.started.elapsed().as_secs_f64(),
            Mode::Offline => self.frames as f64 / self.sample_rate as f64,
        }
    }

    fn add(&mut self, kind: Kind, params: [Param; 2]) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        if self.mode == Mode::Offline {
            self.nodes.insert(id, Node::new(kind, params));
            self.order.push(id);
        }
        id
    }

    fn connect(&mut self, src: u64, dst: u64, param: Option<usize>) {
        if let Some(n) = self.nodes.get_mut(&src) {
            n.outs.push(Edge { to: dst, param });
        }
    }

    /// Kahn, over both audio edges and modulation edges — an LFO has to run
    /// before the filter whose cutoff it is driving.
    fn topo(&self) -> Vec<u64> {
        let mut indegree: HashMap<u64, usize> = self.order.iter().map(|&i| (i, 0)).collect();
        for id in &self.order {
            if let Some(n) = self.nodes.get(id) {
                for e in &n.outs {
                    if let Some(d) = indegree.get_mut(&e.to) {
                        *d += 1;
                    }
                }
            }
        }
        let mut queue: Vec<u64> = self
            .order
            .iter()
            .copied()
            .filter(|i| indegree.get(i) == Some(&0))
            .collect();
        let mut out = Vec::with_capacity(self.order.len());
        let mut head = 0;
        while head < queue.len() {
            let id = queue[head];
            head += 1;
            out.push(id);
            if let Some(n) = self.nodes.get(&id) {
                for e in &n.outs {
                    if let Some(d) = indegree.get_mut(&e.to) {
                        *d -= 1;
                        if *d == 0 {
                            queue.push(e.to);
                        }
                    }
                }
            }
        }
        if out.len() == self.order.len() {
            out
        } else {
            self.order.clone()
        }
    }

    fn render(&mut self, frames: usize) -> Vec<f32> {
        let mut out = Vec::with_capacity(frames);
        while out.len() < frames {
            let n = BLOCK.min(frames - out.len());
            self.render_block(n, &mut out);
        }
        out
    }

    fn render_block(&mut self, n: usize, out: &mut Vec<f32>) {
        let sr = self.sample_rate as f64;
        let t0 = self.frames as f64 / sr;

        for id in &self.order {
            if let Some(node) = self.nodes.get_mut(id) {
                node.input[..n].fill(0.0);
                for p in node.params.iter_mut() {
                    p.modulation[..n].fill(0.0);
                }
            }
        }

        for id in self.topo() {
            // Take the node out so it can write into its targets while it is
            // being rendered; the topological order guarantees no target has
            // run yet.
            let Some(mut node) = self.nodes.remove(&id) else {
                continue;
            };
            node.render(n, t0, sr);
            for e in &node.outs {
                if let Some(target) = self.nodes.get_mut(&e.to) {
                    match e.param {
                        None => {
                            for i in 0..n {
                                target.input[i] += node.output[i];
                            }
                        }
                        Some(slot) => {
                            for i in 0..n {
                                target.params[slot].modulation[i] += node.output[i];
                            }
                        }
                    }
                }
            }
            self.nodes.insert(id, node);
        }

        match self.nodes.get(&self.dest) {
            Some(d) => out.extend_from_slice(&d.input[..n]),
            None => out.extend(std::iter::repeat_n(0.0, n)),
        }
        self.frames += n as u64;
    }
}

/// Naive (aliasing) waveform lookup, phase in `[0, 1)`.
fn wave_sample(wave: Waveform, phase: f64) -> f64 {
    match wave {
        Waveform::Sine => (phase * std::f64::consts::TAU).sin(),
        Waveform::Square => {
            if phase < 0.5 {
                1.0
            } else {
                -1.0
            }
        }
        Waveform::Sawtooth => 2.0 * phase - 1.0,
        // Starts at 0 and rises, like the spec's triangle.
        Waveform::Triangle => {
            if phase < 0.25 {
                4.0 * phase
            } else if phase < 0.75 {
                2.0 - 4.0 * phase
            } else {
                4.0 * phase - 4.0
            }
        }
    }
}

/// RBJ cookbook coefficients, normalised by a0, in the WebAudio spec's
/// convention: `Q` is in DECIBELS for lowpass/highpass and LINEAR for
/// bandpass. Returns `([b0, b1, b2], [a1, a2])`.
fn biquad(kind: FilterType, f0: f64, q: f64, sr: f64) -> ([f64; 3], [f64; 2]) {
    let w0 = std::f64::consts::TAU * f0 / sr;
    let (sin_w0, cos_w0) = w0.sin_cos();
    let (b0, b1, b2, a0, a1, a2) = match kind {
        FilterType::Lowpass => {
            let alpha = sin_w0 / (2.0 * 10f64.powf(q / 20.0));
            (
                (1.0 - cos_w0) * 0.5,
                1.0 - cos_w0,
                (1.0 - cos_w0) * 0.5,
                1.0 + alpha,
                -2.0 * cos_w0,
                1.0 - alpha,
            )
        }
        FilterType::Highpass => {
            let alpha = sin_w0 / (2.0 * 10f64.powf(q / 20.0));
            (
                (1.0 + cos_w0) * 0.5,
                -(1.0 + cos_w0),
                (1.0 + cos_w0) * 0.5,
                1.0 + alpha,
                -2.0 * cos_w0,
                1.0 - alpha,
            )
        }
        FilterType::Bandpass => {
            let alpha = sin_w0 / (2.0 * q.max(1e-4));
            (alpha, 0.0, -alpha, 1.0 + alpha, -2.0 * cos_w0, 1.0 - alpha)
        }
    };
    ([b0 / a0, b1 / a0, b2 / a0], [a1 / a0, a2 / a0])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exponential_ramp_follows_the_webaudio_curve() {
        let mut p = Param::new(0.0);
        p.push(PEvent::new(0.0, 0.07, Curve::Set));
        p.push(PEvent::new(0.5, 0.001, Curve::Exponential));
        // v(t) = v0 * (v1/v0)^(t/dur) — geometric, so the midpoint is the
        // GEOMETRIC mean, not the arithmetic one a linear release would give.
        let mid = p.at(0.25);
        assert!((mid - (0.07f64 * 0.001).sqrt()).abs() < 1e-9, "{mid}");
        assert!(mid < (0.07 + 0.001) / 2.0);
        assert!((p.at(0.5) - 0.001).abs() < 1e-12);
        assert!((p.at(9.0) - 0.001).abs() < 1e-12);
    }

    #[test]
    fn linear_ramp_and_holds() {
        let mut p = Param::new(0.0);
        p.push(PEvent::new(0.0, 0.0, Curve::Set));
        p.push(PEvent::new(1.2, 0.05, Curve::Linear));
        assert!((p.at(0.0) - 0.0).abs() < 1e-12);
        assert!((p.at(0.6) - 0.025).abs() < 1e-9);
        assert!((p.at(1.2) - 0.05).abs() < 1e-12);
        assert!((p.at(5.0) - 0.05).abs() < 1e-12);
    }

    #[test]
    fn stepped_values_do_not_glide() {
        // KeeperGreet's two notes are SET, not ramped.
        let mut p = Param::new(440.0);
        p.push(PEvent::new(0.06, 330.0, Curve::Set));
        p.push(PEvent::new(0.15, 247.0, Curve::Set));
        assert_eq!(p.at(0.0), 440.0);
        assert_eq!(p.at(0.10), 330.0);
        assert_eq!(p.at(0.149), 330.0);
        assert_eq!(p.at(0.2), 247.0);
    }

    #[test]
    fn cancel_drops_only_the_future() {
        let mut p = Param::new(0.0);
        p.push(PEvent::new(0.0, 0.0, Curve::Set));
        p.push(PEvent::new(1.2, 0.05, Curve::Linear));
        p.events.retain(|e| e.t < 0.6);
        assert_eq!(p.events.len(), 1);
        assert_eq!(p.at(0.6), 0.0);
    }

    #[test]
    fn silent_mode_stores_nothing() {
        let be = SoftBackend::live().expect("silent backend always builds");
        for _ in 0..64 {
            let o = be.create_oscillator(Waveform::Sine);
            let g = be.create_gain();
            be.connect(&o, &g);
            be.connect(&g, &be.destination());
            be.start(&o, 0.0);
        }
        assert!(lock(&be.g).nodes.is_empty());
        assert!(be.render_seconds(1.0).is_empty());
    }
}
