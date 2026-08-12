//! The recipes, the mixer, and the tavern bed — written once, for every
//! backend.
//!
//! Sources, verbatim:
//!  · `legacy/src/game/pinball-knight/sfx/{pinball,combat,world,run}.ts`
//!  · `legacy/src/game/pinball-knight/sfx/gate.ts` (the coin ladder + limiter)
//!  · `legacy/src/scenes/tavern/audio.ts` (bed, anvil, greet, focus, plunger)
//!
//! ── ONE MASTER, AND WHY ──────────────────────────────────────────────────────
//! Every sting used to connect its own gain straight to `destination`, which
//! meant there was no such thing as "the volume" — 28 float literals and a
//! `muted` boolean. Everything here goes through ONE master gain instead, so
//! mute and volume are one node, and the 28 literals stay exactly where they
//! were (a unity-gain node is provably inaudible; a rebalance has to be its
//! own change, reviewable by ear).
//!
//! ── THE CLOCK IS THE AUDIO CLOCK ─────────────────────────────────────────────
//! The coin ladder and the bumper limiter key on `current_time()`, never wall
//! time. A suspended context (backgrounded tab, autoplay block) then does not
//! burn through the budget while nothing is audible, and the gate and the
//! scheduling share one timeline.
//!
//! PORTS: `sfx/pinball.ts`, `sfx/combat.ts`, `sfx/world.ts`, `sfx/run.ts`, `sfx/gate.ts`, `legacy/src/scenes/tavern/audio.ts`

use std::sync::{Mutex, MutexGuard};

use crate::synth::{beep, burst, decaying_burst};
use crate::{AudioBackend, AudioParam, FilterType, Patch, Rng, Waveform};

/// Seconds to fade the tavern room tone up on entry and down on exit.
const FADE: f64 = 1.2;

/// Coin cluster: a hard ceiling on chimes, the stagger between them, and the
/// silence that starts a fresh ladder.
const COIN_LADDER: [f64; 6] = [1046.5, 1174.7, 1396.9, 1568.0, 1864.7, 2093.0];
const COIN_VOICES: u32 = 5;
const COIN_STEP: f64 = 0.055;
const COIN_RESET: f64 = 0.35;

/// Bumpers can be hit several times inside one physics step; below this gap
/// they machine-gun instead of reading as hits.
const BUMPER_MIN_GAP: f64 = 0.09;

/// The tavern room tone, once started.
struct Bed<B: AudioBackend> {
    fire_gain: B::Param,
    hum_gain: B::Param,
    /// fire source, LFO, hum — everything that has to be stopped.
    sources: Vec<B::Node>,
}

/// A burst of the same sound in flight — the coin sweep.
#[derive(Debug, Clone, Copy)]
struct Cluster {
    at: f64,
    n: u32,
}

struct State<B: AudioBackend> {
    muted: bool,
    volume: f32,
    rng: Rng,
    coin: Option<Cluster>,
    last_bumper: Option<f64>,
    bed: Option<Bed<B>>,
}

/// The context, its master gain, and the patch layer's own bookkeeping.
pub struct Engine<B: AudioBackend> {
    be: B,
    master: B::Node,
    master_gain: B::Param,
    st: Mutex<State<B>>,
}

impl<B: AudioBackend> Engine<B> {
    pub fn new(be: B, muted: bool, volume: f32) -> Engine<B> {
        let master = be.create_gain();
        let master_gain = be.gain(&master);
        master_gain.set_value(master_level(muted, volume));
        be.connect(&master, &be.destination());
        Engine {
            be,
            master,
            master_gain,
            st: Mutex::new(State {
                muted,
                volume,
                rng: Rng::default(),
                coin: None,
                last_bumper: None,
                bed: None,
            }),
        }
    }

    pub fn backend(&self) -> &B {
        &self.be
    }

    pub fn now(&self) -> f64 {
        self.be.current_time()
    }

    pub fn sample_rate(&self) -> f32 {
        self.be.sample_rate()
    }

    pub fn resume(&self) {
        self.be.resume();
    }

    /// Never poison: a lock we failed to release cleanly is not a reason to
    /// take the game down over a sound effect.
    fn lock(&self) -> MutexGuard<'_, State<B>> {
        self.st.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn set_master(&self, muted: bool, volume: f32) {
        let mut st = self.lock();
        st.muted = muted;
        st.volume = volume;
        self.master_gain.set_value(master_level(muted, volume));
    }

    pub fn play(&self, patch: Patch) {
        let mut st = self.lock();
        // Cheap early-out: muted means no node is built at all, not a node
        // built and multiplied by zero.
        if st.muted || st.volume <= 0.0 {
            return;
        }
        let t = self.be.current_time();
        match patch {
            Patch::StationFocus => self.station_focus(),
            Patch::KeeperGreet => self.keeper_greet(),
            Patch::Plunger => self.plunger(),
            Patch::Anvil => self.anvil(&mut st),
            Patch::Roll { p } => {
                let p = if p > 0.0 {
                    p
                } else {
                    0.92 + st.rng.f64() * 0.16
                };
                self.roll(&mut st, p);
            }
            Patch::Break => self.brk(&mut st),
            Patch::Coin => self.coin(&mut st, t),
            Patch::Bumper { p } => {
                if let Some(prev) = st.last_bumper {
                    if t - prev < BUMPER_MIN_GAP {
                        return;
                    }
                }
                st.last_bumper = Some(t);
                let p = if p > 0.0 {
                    p
                } else {
                    0.94 + st.rng.f64() * 0.12
                };
                self.bumper(p);
            }
            Patch::LevelStart { at_offset } => self.level_start(&mut st, at_offset),
        }
    }

    // ── Tavern one-shots (legacy/src/scenes/tavern/audio.ts) ────────────────

    /// Stepping into a station's radius — a soft, non-intrusive confirm.
    fn station_focus(&self) {
        let t = self.be.current_time();
        let osc = self.be.create_oscillator(Waveform::Sine);
        let f = self.be.frequency(&osc);
        f.set_value_at_time(520.0, t);
        f.exponential_ramp_to_value_at_time(780.0, t + 0.09);
        let g = self.be.create_gain();
        let gain = self.be.gain(&g);
        gain.set_value_at_time(0.0, t);
        gain.linear_ramp_to_value_at_time(0.035, t + 0.01);
        gain.exponential_ramp_to_value_at_time(0.001, t + 0.14);
        self.be.connect(&osc, &g);
        self.be.connect(&g, &self.master);
        self.be.start(&osc, t);
        self.be.stop(&osc, t + 0.16);
    }

    /// A keeper noticing you — a short, warm, falling two-note.
    ///
    /// The pitch is STEPPED, not ramped: it plays on the same frame as
    /// `StationFocus`, and the pair has to read as one event ("you've arrived,
    /// and someone looked up") rather than two competing glides. The gain also
    /// holds at 0 until t+0.06 so the two notes do not overlap the focus blip.
    fn keeper_greet(&self) {
        let t = self.be.current_time();
        let osc = self.be.create_oscillator(Waveform::Triangle);
        let f = self.be.frequency(&osc);
        f.set_value_at_time(330.0, t + 0.06);
        f.set_value_at_time(247.0, t + 0.15);
        let g = self.be.create_gain();
        let gain = self.be.gain(&g);
        gain.set_value_at_time(0.0, t);
        gain.set_value_at_time(0.0, t + 0.06);
        gain.linear_ramp_to_value_at_time(0.026, t + 0.08);
        gain.exponential_ramp_to_value_at_time(0.001, t + 0.30);
        self.be.connect(&osc, &g);
        self.be.connect(&g, &self.master);
        self.be.start(&osc, t);
        self.be.stop(&osc, t + 0.32);
    }

    /// Pulling the plunger — the wind-up (180→70) and the release (→900).
    fn plunger(&self) {
        let t = self.be.current_time();
        let osc = self.be.create_oscillator(Waveform::Sawtooth);
        let f = self.be.frequency(&osc);
        f.set_value_at_time(180.0, t);
        f.exponential_ramp_to_value_at_time(70.0, t + 0.22);
        f.exponential_ramp_to_value_at_time(900.0, t + 0.42);
        let g = self.be.create_gain();
        let gain = self.be.gain(&g);
        gain.set_value_at_time(0.0, t);
        gain.linear_ramp_to_value_at_time(0.07, t + 0.02);
        gain.exponential_ramp_to_value_at_time(0.001, t + 0.50);
        self.be.connect(&osc, &g);
        self.be.connect(&g, &self.master);
        self.be.start(&osc, t);
        self.be.stop(&osc, t + 0.52);
    }

    /// The smith's hammer — a bright metal ping over a dull thud. Two layers:
    /// a band-passed strike with its decay baked into the samples, and a ring
    /// that falls 880→620 under it.
    fn anvil(&self, st: &mut State<B>) {
        decaying_burst(
            &self.be,
            &self.master,
            &mut st.rng,
            0.18,
            0.09,
            FilterType::Bandpass,
            3200.0,
            Some(2.5),
            0.0,
        );
        let t = self.be.current_time();
        let osc = self.be.create_oscillator(Waveform::Triangle);
        let f = self.be.frequency(&osc);
        f.set_value_at_time(880.0, t);
        f.exponential_ramp_to_value_at_time(620.0, t + 0.30);
        let g = self.be.create_gain();
        let gain = self.be.gain(&g);
        gain.set_value_at_time(0.0, t);
        gain.linear_ramp_to_value_at_time(0.05, t + 0.006);
        gain.exponential_ramp_to_value_at_time(0.001, t + 0.34);
        self.be.connect(&osc, &g);
        self.be.connect(&g, &self.master);
        self.be.start(&osc, t);
        self.be.stop(&osc, t + 0.36);
    }

    // ── Dungeon stings (legacy sfx/*.ts) ────────────────────────────────────

    /// Dodge-roll AND rolling momentum — a low body whoosh. Pitch is jittered
    /// ±8% so a flurry of dodges does not machine-gun one identical sample.
    fn roll(&self, st: &mut State<B>, p: f64) {
        burst(
            &self.be,
            &self.master,
            &mut st.rng,
            0.16,
            0.11,
            FilterType::Lowpass,
            700.0 * p,
            0.0,
        );
        beep(
            &self.be,
            &self.master,
            Waveform::Sine,
            260.0 * p,
            Some(90.0 * p),
            0.14,
            0.05,
            0.0,
        );
    }

    /// Something shattering — a bright crack, a body, and a low thud.
    fn brk(&self, st: &mut State<B>) {
        burst(
            &self.be,
            &self.master,
            &mut st.rng,
            0.08,
            0.22,
            FilterType::Highpass,
            1800.0,
            0.0,
        );
        burst(
            &self.be,
            &self.master,
            &mut st.rng,
            0.16,
            0.12,
            FilterType::Bandpass,
            700.0,
            0.05,
        );
        beep(
            &self.be,
            &self.master,
            Waveform::Square,
            140.0,
            Some(60.0),
            0.12,
            0.10,
            0.03,
        );
    }

    /// A coin absorbed — a bright struck chime with an octave tail.
    ///
    /// One kill mints 2-6 coins within a few hundred ms, so firing the same
    /// chime per coin produces a BUZZ (identical partials stacking in phase),
    /// not a jingle. Each coin in a cluster takes the next rung of the ladder
    /// and is scheduled `COIN_STEP` later, which turns a burst into a rising
    /// arpeggio; past the cap the rest bank silently.
    fn coin(&self, st: &mut State<B>, t: f64) {
        let Some(i) = voice(&mut st.coin, t, COIN_VOICES, COIN_RESET) else {
            return; // cluster full — adding more only muddies it
        };
        let at = i as f64 * COIN_STEP;
        let rung = COIN_LADDER[(i as usize).min(COIN_LADDER.len() - 1)];
        let f = rung * (0.99 + st.rng.f64() * 0.02);
        beep(
            &self.be,
            &self.master,
            Waveform::Triangle,
            f,
            None,
            0.07,
            0.07,
            at,
        );
        beep(
            &self.be,
            &self.master,
            Waveform::Triangle,
            f * 2.0,
            None,
            0.10,
            0.04,
            at + 0.045,
        );
    }

    /// Pop bumper — a bright arcade PING. The second layer's glide target is
    /// deliberately its own start pitch: a steady sine on top of the rising
    /// square is what gives the ping a body instead of a chirp.
    fn bumper(&self, p: f64) {
        beep(
            &self.be,
            &self.master,
            Waveform::Square,
            620.0 * p,
            Some(980.0 * p),
            0.08,
            0.09,
            0.0,
        );
        beep(
            &self.be,
            &self.master,
            Waveform::Sine,
            1240.0 * p,
            Some(1240.0 * p),
            0.05,
            0.05,
            0.0,
        );
    }

    /// ARRIVAL on a new floor — a low gate-swing opening into a root + fifth.
    ///
    /// Everything shifts by `at_offset` on the AUDIO clock. The intro
    /// schedules it ~0.4 s ahead so it lands under the plunger BOING rather
    /// than on top of it; a frame timer would drift against the samples it is
    /// trying to sit beside.
    fn level_start(&self, st: &mut State<B>, at_offset: f64) {
        let o = at_offset.max(0.0);
        burst(
            &self.be,
            &self.master,
            &mut st.rng,
            0.34,
            0.09,
            FilterType::Lowpass,
            420.0,
            o,
        );
        beep(
            &self.be,
            &self.master,
            Waveform::Sawtooth,
            78.0,
            Some(62.0),
            0.30,
            0.09,
            o,
        );
        beep(
            &self.be,
            &self.master,
            Waveform::Triangle,
            196.0,
            None,
            0.34,
            0.09,
            o + 0.16,
        );
        beep(
            &self.be,
            &self.master,
            Waveform::Triangle,
            294.0,
            None,
            0.30,
            0.06,
            o + 0.22,
        );
    }

    // ── The tavern bed (legacy/src/scenes/tavern/audio.ts) ──────────────────

    /// Start the room tone. Safe to call twice; the second call is a no-op.
    ///
    /// Two layers: a looped brown-noise hearth low-passed into a fire roar
    /// (with a 0.23 Hz wobble on the cutoff so it breathes instead of sitting
    /// flat), and a 54 Hz hum — the dungeon running somewhere below. Both fade
    /// in, because a room tone that STARTS abruptly is more noticeable than
    /// one that was never there.
    pub fn bed_start(&self) {
        let mut st = self.lock();
        if st.bed.is_some() {
            return;
        }
        let t = self.be.current_time();

        // Brownish noise: integrating white noise tilts the spectrum down,
        // which is much closer to a fire than flat white hiss.
        let len = (self.be.sample_rate() as f64 * 2.0) as usize;
        let len = len.max(1);
        let mut data = vec![0.0f32; len];
        let mut prev = 0.0f32;
        for s in data.iter_mut() {
            prev = prev * 0.96 + st.rng.unit() * 0.08;
            *s = prev;
        }

        let fire = self.be.create_buffer_source(&data, true);
        let fire_filter = self.be.create_biquad(FilterType::Lowpass, 420.0, None);
        let fire_g = self.be.create_gain();
        let fire_gain = self.be.gain(&fire_g);
        fire_gain.set_value_at_time(0.0, t);
        fire_gain.linear_ramp_to_value_at_time(0.05, t + FADE);

        // A slow wobble on the cutoff: ±120 Hz around 420, i.e. 300..540.
        let lfo = self.be.create_oscillator(Waveform::Sine);
        self.be.frequency(&lfo).set_value(0.23);
        let lfo_g = self.be.create_gain();
        self.be.gain(&lfo_g).set_value(120.0);
        self.be.connect(&lfo, &lfo_g);
        self.be
            .connect_param(&lfo_g, &self.be.frequency(&fire_filter));

        self.be.connect(&fire, &fire_filter);
        self.be.connect(&fire_filter, &fire_g);
        self.be.connect(&fire_g, &self.master);

        let hum = self.be.create_oscillator(Waveform::Sine);
        self.be.frequency(&hum).set_value(54.0);
        let hum_g = self.be.create_gain();
        let hum_gain = self.be.gain(&hum_g);
        hum_gain.set_value_at_time(0.0, t);
        hum_gain.linear_ramp_to_value_at_time(0.022, t + FADE);
        self.be.connect(&hum, &hum_g);
        self.be.connect(&hum_g, &self.master);

        self.be.start(&fire, t);
        self.be.start(&lfo, t);
        self.be.start(&hum, t);

        st.bed = Some(Bed {
            fire_gain,
            hum_gain,
            sources: vec![fire, lfo, hum],
        });
    }

    /// Fade the room tone out over `FADE * 0.5`, then stop the sources — a
    /// stop before the fade lands is a click, which is the one thing a room
    /// tone must never do.
    pub fn bed_stop(&self) {
        let mut st = self.lock();
        let Some(bed) = st.bed.take() else {
            return;
        };
        let t = self.be.current_time();
        // Read the live values BEFORE cancelling: mid-fade-in, the cancelled
        // param falls back to its last EVENT (0), so cancelling first would
        // snap to silence instead of fading from where it actually is.
        let fire_now = bed.fire_gain.value();
        let hum_now = bed.hum_gain.value();
        for (p, v) in [(&bed.fire_gain, fire_now), (&bed.hum_gain, hum_now)] {
            p.cancel_scheduled_values(t);
            p.set_value_at_time(v, t);
            p.linear_ramp_to_value_at_time(0.0, t + FADE * 0.5);
        }
        let end = t + FADE * 0.5 + 0.05;
        for src in &bed.sources {
            self.be.stop(src, end);
        }
    }
}

/// `gain = if muted { 0 } else { volume² }`.
///
/// The square is the perceptual curve: amplitude is linear but LOUDNESS is
/// not, so a slider at 0.5 with a linear gain still sounds most of the way up.
fn master_level(muted: bool, volume: f32) -> f64 {
    if muted {
        0.0
    } else {
        let v = volume.clamp(0.0, 1.0) as f64;
        v * v
    }
}

/// Voice allocation for a BURST of the same sound.
///
/// Returns the index within the current cluster, or `None` when it is full —
/// an INDEX and not a boolean because callers use it musically: the coin sting
/// walks a pitch ladder by index, so twelve coins in one sweep play a rising
/// arpeggio instead of twelve copies of one note. The cluster resets after
/// `window` seconds of silence, so a second sweep starts from the bottom.
fn voice(slot: &mut Option<Cluster>, t: f64, cap: u32, window: f64) -> Option<u32> {
    match slot {
        Some(c) if t - c.at <= window => {
            c.at = t;
            if c.n >= cap {
                return None;
            }
            let i = c.n;
            c.n += 1;
            Some(i)
        }
        _ => {
            *slot = Some(Cluster { at: t, n: 1 });
            Some(0)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn master_level_squares_and_mutes() {
        assert_eq!(master_level(true, 1.0), 0.0);
        assert_eq!(master_level(false, 1.0), 1.0);
        assert!((master_level(false, 0.5) - 0.25).abs() < 1e-12);
    }

    #[test]
    fn coin_cluster_walks_then_caps_then_resets() {
        let mut slot = None;
        // A sweep: five rungs, then the cap swallows the rest.
        for expect in 0..COIN_VOICES {
            assert_eq!(voice(&mut slot, 0.0, COIN_VOICES, COIN_RESET), Some(expect));
        }
        assert_eq!(voice(&mut slot, 0.01, COIN_VOICES, COIN_RESET), None);
        // …and a capped call still slides the window, so the reset is
        // measured from the last ATTEMPT, not the last sound.
        assert_eq!(voice(&mut slot, 0.2, COIN_VOICES, COIN_RESET), None);
        assert_eq!(voice(&mut slot, 0.6, COIN_VOICES, COIN_RESET), Some(0));
    }
}
