//! WebAudio-shaped audio abstraction — one set of recipes, three backends.
//!
//! The legacy `sfx/` patches (legacy/src/game/pinball-knight/sfx/) and the
//! tavern bed (legacy/src/scenes/tavern/audio.ts) are written in WebAudio
//! vocabulary — oscillator/gain/biquad graphs with `currentTime`-anchored
//! param ramps — and every sound is synthesized (the repo carries zero audio
//! files; that is the house rule). This crate mirrors that vocabulary so the
//! patches port near-1:1, and so they are written EXACTLY ONCE:
//!
//! * [`synth`] — the two primitives (`beep`, `burst`), generic over the backend
//! * [`patches`] — the recipes and the tavern bed, generic over the backend
//!
//! ── THE THREE BACKENDS ───────────────────────────────────────────────────────
//! | target                | module   | device output | why                     |
//! |-----------------------|----------|---------------|-------------------------|
//! | `wasm32`              | [`web`]  | yes           | the browser's own graph |
//! | native + `windows`    | `native` | yes (WASAPI)  | the play target         |
//! | native, anything else | [`soft`] | NO            | see below               |
//!
//! `web-audio-api` pulls cpal, and cpal's Linux tier needs the ALSA dev
//! headers. The dev box has the runtime libs but not the headers and cannot
//! install them, so a hard dependency there would break `cargo check`/`test`/
//! `clippy` for the WHOLE workspace. Linux therefore runs [`soft`]: a
//! dependency-free block-wise renderer of the same graph. It is silent live
//! (no device), but it is a real renderer — and it is what the offline tests
//! in `tests/render.rs` assert against, on every platform, with no audio
//! hardware and no system libraries.
//!
//! ── WHY THE TRAIT IS FLAT ────────────────────────────────────────────────────
//! An earlier sketch had one trait per node kind (`OscillatorNode`,
//! `GainNode`, …). That does not survive three backends: every backend needs a
//! SINGLE uniform handle type to be a `connect` target (`web-audio-api` wants
//! `&dyn AudioNode`, web-sys wants `web_sys::AudioNode`, the software graph
//! wants an id), so the per-kind types collapse into per-kind CONSTRUCTORS on
//! [`AudioBackend`] returning one `Node` handle. [`AudioParam`] stays a trait
//! of its own because param automation is the part that actually differs and
//! the part hand-rolled mixers get wrong.
//!
//! ── FAIL-SILENT ──────────────────────────────────────────────────────────────
//! Silence is the correct failure mode for a sound effect. [`Sfx::new`] is
//! wrapped in `catch_unwind` and returns `None` rather than propagating; every
//! other entry point is infallible and early-returns.
//!
//! PORTS: `sfx/bus.ts`, `sfx/registry.ts`, `sfx/index.ts`, `legacy/src/utils/audio-manager.ts`, `legacy/src/scenes/tavern/gambler/audio.ts`, `legacy/src/scenes/tavern/gambler/blackjack-audio.ts`, `legacy/src/scenes/tavern/gambler/roulette-audio.ts`

#![forbid(unsafe_code)]

pub mod ambience;
pub mod blackjack_audio;
pub mod bus;
pub mod gambler_audio;
pub mod manager;
pub mod patches;
pub mod registry;
pub mod roulette_audio;
pub mod sfx_hub;
pub mod synth;

pub use ambience::*;
pub use blackjack_audio::*;
pub use gambler_audio::*;
pub use manager::*;
pub use registry::*;
pub use roulette_audio::*;
pub use sfx_hub::*;

#[cfg(not(target_arch = "wasm32"))]
pub mod soft;

#[cfg(all(not(target_arch = "wasm32"), target_os = "windows"))]
pub mod native;

#[cfg(target_arch = "wasm32")]
pub mod web;

// ── The live backend for this target ────────────────────────────────────────
#[cfg(all(not(target_arch = "wasm32"), target_os = "windows"))]
type LiveBackend = native::NativeBackend;
#[cfg(all(not(target_arch = "wasm32"), not(target_os = "windows")))]
type LiveBackend = soft::SoftBackend;
#[cfg(target_arch = "wasm32")]
type LiveBackend = web::WebBackend;

// ── Graph vocabulary ────────────────────────────────────────────────────────

/// Oscillator shapes. Same four the legacy patches name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Waveform {
    Sine,
    Square,
    Sawtooth,
    Triangle,
}

/// Biquad shapes. Same three the legacy patches name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FilterType {
    Lowpass,
    Highpass,
    Bandpass,
}

/// `AudioParam` automation — the hard part of WebAudio and the reason this
/// abstraction exists.
///
/// Note `exponential_ramp_to_value_at_time` is NOT interchangeable with a
/// linear release: WebAudio's exponential curve is `v0 * (v1/v0)^(x/dur)`, and
/// on the 0.07–0.09 s stings the difference is plainly audible. Every backend
/// here implements that curve, [`soft`] included.
pub trait AudioParam: Clone {
    /// The intrinsic value, used until (and between) automation events.
    fn set_value(&self, value: f64);
    /// The value right now, automation included — what `param.value` reads.
    fn value(&self) -> f64;
    fn set_value_at_time(&self, value: f64, when: f64);
    fn linear_ramp_to_value_at_time(&self, value: f64, when: f64);
    fn exponential_ramp_to_value_at_time(&self, value: f64, when: f64);
    fn cancel_scheduled_values(&self, when: f64);
}

/// The subset of the WebAudio graph the ported patches actually use.
/// Kept minimal on purpose — grow it only when a ported patch needs a node.
pub trait AudioBackend {
    /// One uniform handle for every node, so `connect` has a single signature.
    type Node: Clone;
    type Param: AudioParam;

    /// The audio clock, in seconds. Every schedule and every gate reads THIS,
    /// never wall time — a suspended context must not burn a rate-limit
    /// budget while nothing is audible.
    fn current_time(&self) -> f64;
    fn sample_rate(&self) -> f32;
    fn destination(&self) -> Self::Node;

    fn create_oscillator(&self, wave: Waveform) -> Self::Node;
    fn create_gain(&self) -> Self::Node;
    /// `q == None` leaves the spec default of 1.0 in place.
    fn create_biquad(&self, kind: FilterType, freq: f64, q: Option<f64>) -> Self::Node;
    /// A one-channel buffer source at the context's own sample rate.
    fn create_buffer_source(&self, data: &[f32], looping: bool) -> Self::Node;

    fn connect(&self, src: &Self::Node, dst: &Self::Node);
    /// Signal-rate modulation: the source is SUMMED into the param's value.
    fn connect_param(&self, src: &Self::Node, dst: &Self::Param);

    /// The gain param of a gain node.
    fn gain(&self, node: &Self::Node) -> Self::Param;
    /// The frequency param of an oscillator or a biquad.
    fn frequency(&self, node: &Self::Node) -> Self::Param;

    fn start(&self, node: &Self::Node, when: f64);
    fn stop(&self, node: &Self::Node, when: f64);

    /// Browser gesture unlock. No-op everywhere else.
    fn resume(&self) {}
}

// ── The patch vocabulary the game speaks ────────────────────────────────────

/// Every sound the ported scenes can ask for.
///
/// `Roll`/`Bumper` carry the per-hit pitch jitter the legacy stings roll for
/// themselves. Pass `p = 0.0` (or use [`Patch::roll`] / [`Patch::bumper`]) to
/// have the engine roll it — that is the normal path, and it keeps the RNG in
/// one place instead of every call site.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Patch {
    StationFocus,
    KeeperGreet,
    Plunger,
    Anvil,
    Roll {
        p: f64,
    },
    Break,
    Coin,
    Bumper {
        p: f64,
    },
    /// Offset on the AUDIO clock, not a Bevy timer: the intro schedules the
    /// arrival sting 0.4 s ahead so it lands under the plunger, and a frame
    /// timer would drift against the samples it is trying to sit beside.
    LevelStart {
        at_offset: f64,
    },
    // Combat & Weapons
    Swing,
    HeavySwing,
    Hit,
    Hurt,
    Gun,
    Bow,
    Flame,
    Freeze,
    // Monsters & NPCs
    Groan,
    ZombieDie,
    Goblin,
    Cackle,
    Ribbit,
    CartBell {
        near: f64,
    },
    // World & Pickups
    Pickup,
    Trapdoor,
}

impl Patch {
    /// `Roll` with the engine rolling its own pitch jitter.
    pub const fn roll() -> Patch {
        Patch::Roll { p: 0.0 }
    }
    /// `Bumper` with the engine rolling its own pitch jitter.
    pub const fn bumper() -> Patch {
        Patch::Bumper { p: 0.0 }
    }
    /// `LevelStart` scheduled immediately.
    pub const fn level_start() -> Patch {
        Patch::LevelStart { at_offset: 0.0 }
    }
    /// `CartBell` with default near (1.0).
    pub const fn cart_bell(near: f64) -> Patch {
        Patch::CartBell { near }
    }
}

// ── The public handle ───────────────────────────────────────────────────────

/// The one audio context, its master gain, and the patch layer's own state
/// (the coin ladder, the bumper rate-limit, the tavern bed).
///
/// Fail-silent: construction returns `None` rather than panicking, and every
/// other method is infallible.
///
/// On wasm the real context is a JS object and therefore not `Send`, so it
/// lives in a `thread_local!` and this handle is a marker. That is what lets
/// the Bevy resource holding it stay `Send + Sync` — Bevy 0.17 has no
/// `!Send` resources.
pub struct Sfx {
    #[cfg(not(target_arch = "wasm32"))]
    engine: Engine<LiveBackend>,
    #[cfg(target_arch = "wasm32")]
    _marker: (),
}

#[cfg(target_arch = "wasm32")]
thread_local! {
    static WASM_ENGINE: std::cell::RefCell<Option<Engine<LiveBackend>>> =
        const { std::cell::RefCell::new(None) };
}

impl Sfx {
    /// Build the context. `None` means "no audio" — never a panic.
    pub fn new(muted: bool, volume: f32) -> Option<Sfx> {
        std::panic::catch_unwind(|| Sfx::build(muted, volume))
            .ok()
            .flatten()
    }

    #[cfg(not(target_arch = "wasm32"))]
    fn build(muted: bool, volume: f32) -> Option<Sfx> {
        let be = LiveBackend::live()?;
        Some(Sfx {
            engine: Engine::new(be, muted, volume),
        })
    }

    #[cfg(target_arch = "wasm32")]
    fn build(muted: bool, volume: f32) -> Option<Sfx> {
        let be = LiveBackend::live()?;
        let engine = Engine::new(be, muted, volume);
        WASM_ENGINE.with(|slot| *slot.borrow_mut() = Some(engine));
        Some(Sfx { _marker: () })
    }

    #[cfg(not(target_arch = "wasm32"))]
    fn with<R>(&self, f: impl FnOnce(&Engine<LiveBackend>) -> R) -> Option<R> {
        Some(f(&self.engine))
    }

    #[cfg(target_arch = "wasm32")]
    fn with<R>(&self, f: impl FnOnce(&Engine<LiveBackend>) -> R) -> Option<R> {
        WASM_ENGINE.with(|slot| slot.borrow().as_ref().map(f))
    }

    /// Master level. `gain = if muted { 0 } else { volume * volume }` — the
    /// square is the perceptual curve the legacy audio-manager applies, so a
    /// slider at half reads as half LOUDNESS, not half amplitude.
    pub fn set_master(&self, muted: bool, volume: f32) {
        self.with(|e| e.set_master(muted, volume));
    }

    /// Browser autoplay unlock, called from the first user gesture. No-op
    /// native.
    pub fn resume(&self) {
        self.with(|e| e.resume());
    }

    /// Fire and forget. Muted contexts early-out before building any node.
    pub fn play(&self, patch: Patch) {
        self.with(|e| e.play(patch));
    }

    /// Tavern room tone up. Idempotent — a second call while a bed lives is a
    /// no-op, exactly like `startTavernAmbience`.
    pub fn bed_start(&self) {
        self.with(|e| e.bed_start());
    }

    /// Tavern room tone down, over a 0.6 s fade.
    pub fn bed_stop(&self) {
        self.with(|e| e.bed_stop());
    }

    /// The audio clock in seconds. Call sites that want to schedule ahead
    /// (the intro's `LevelStart`) offset against this, not against frames.
    pub fn now(&self) -> f64 {
        self.with(|e| e.now()).unwrap_or(0.0)
    }
}

impl std::fmt::Debug for Sfx {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Sfx")
    }
}

// ── Offline rendering (tests) ───────────────────────────────────────────────

/// The same engine, the same recipes, driven by a clock that only advances
/// when you ask it to — the offline half of [`soft`].
///
/// This is the ONLY way the patches are asserted on. It needs no audio device,
/// no ALSA, no browser, and it renders identically on every native target,
/// which is exactly what `tests/render.rs` requires.
#[cfg(not(target_arch = "wasm32"))]
pub struct OfflineSfx {
    engine: Engine<soft::SoftBackend>,
}

#[cfg(not(target_arch = "wasm32"))]
impl OfflineSfx {
    pub fn new(muted: bool, volume: f32, sample_rate: f32) -> OfflineSfx {
        OfflineSfx {
            engine: Engine::new(soft::SoftBackend::offline(sample_rate), muted, volume),
        }
    }

    pub fn set_master(&self, muted: bool, volume: f32) {
        self.engine.set_master(muted, volume);
    }
    pub fn play(&self, patch: Patch) {
        self.engine.play(patch);
    }
    pub fn bed_start(&self) {
        self.engine.bed_start();
    }
    pub fn bed_stop(&self) {
        self.engine.bed_stop();
    }
    pub fn now(&self) -> f64 {
        self.engine.now()
    }
    pub fn sample_rate(&self) -> f32 {
        self.engine.sample_rate()
    }

    /// Advance the clock by `secs` and return every sample produced.
    pub fn render_seconds(&self, secs: f64) -> Vec<f32> {
        self.engine.backend().render_seconds(secs)
    }
}

// ── Tiny deterministic PRNG ─────────────────────────────────────────────────

/// xorshift64*. The patches need "a hair of detune" and white noise, not
/// statistical quality, and a hand-rolled generator keeps the crate
/// dependency-free (which is the whole point of the [`soft`] tier).
///
/// Seeded from a constant on purpose: identical launches sound identical,
/// which is inaudible in play and is what makes the offline tests reproducible.
#[derive(Debug, Clone)]
pub struct Rng(u64);

impl Default for Rng {
    fn default() -> Self {
        Rng(0x9E37_79B9_7F4A_7C15)
    }
}

impl Rng {
    pub fn new(seed: u64) -> Rng {
        Rng(if seed == 0 { 1 } else { seed })
    }

    fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    /// Uniform in `[0, 1)` — `Math.random()`.
    pub fn f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }

    /// Uniform in `[-1, 1)` — the white-noise sample the bursts want.
    pub fn unit(&mut self) -> f32 {
        (self.f64() * 2.0 - 1.0) as f32
    }
}
