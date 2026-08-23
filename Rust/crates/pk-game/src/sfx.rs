//! 🔊 SOUND — the Bevy side of `pk_audio`.
//!
//! Everything is synthesized (house rule: the repo carries zero audio files).
//! Call sites raise a [`SfxEvent`]; this module owns the one audio context and
//! is the only place that touches it.
//!
//! ── WHY A MESSAGE AND NOT A DIRECT CALL ──────────────────────────────────────
//! The context is one resource, and a dozen scattered call sites reaching into
//! it is how the legacy game ended up with 28 gain nodes wired straight to
//! `destination` and no such thing as "the volume". A message keeps the graph
//! behind one drain, so mute, level and rate-limiting are one place.
//!
//! Bevy 0.17 renamed the buffered-event API to **messages** — `#[derive(Message)]`,
//! `add_message::<T>()`, `MessageWriter`/`MessageReader`. `Event` still exists
//! in 0.17.3 but now means the observer/trigger kind, which is not what this
//! wants (verified against bevy_ecs-0.17.3: `message::{Message, MessageReader,
//! MessageWriter}` in its prelude).
//!
//! ── WIRING ───────────────────────────────────────────────────────────────────
//! Call sites live in `main.rs` / `tavern.rs` / `intro.rs` and are wired
//! THERE, not here: this module only has to be added as a plugin and then
//! written to with `MessageWriter<SfxEvent>`.
//!
//! The intro's arrival sting wants a lookahead — legacy schedules it ~0.4 s out
//! on the AUDIO clock so it lands under the plunger BOING instead of on top of
//! it. `SfxEvent::LevelStart` fires immediately; for the scheduled form call
//! [`Audio::play`] with `Patch::LevelStart { at_offset }` directly, which is
//! why that method is public.
//!
//! PORTS-NOTHING — the Bevy<->pk-audio bridge

// Most of this surface is dead until those call sites land — raising the
// messages is deliberately not this module's job. Drop this allow once
// `main.rs`/`tavern.rs`/`intro.rs` are writing to `SfxEvent`.
#![allow(dead_code)]

use bevy::prelude::*;
use pk_audio::{Patch, Sfx};

/// Everything a scene can ask for. One variant per legacy sting, plus the two
/// tavern room-tone edges.
#[derive(Message, Clone, Copy, Debug, PartialEq, Eq)]
pub enum SfxEvent {
    /// Stepping into a station's radius.
    StationFocus,
    /// A keeper noticing you walk up.
    KeeperGreet,
    /// The plunger wind-up and release.
    Plunger,
    /// The smith's hammer landing.
    Anvil,
    /// Dodge-roll and rolling momentum.
    Roll,
    /// Something shattering.
    Break,
    /// A coin absorbed. Clusters arpeggiate; see `pk_audio::patches`.
    Coin,
    /// Pop bumper. Rate-limited to 90 ms inside the patch layer.
    Bumper,
    /// Arrival on a new floor.
    LevelStart,
    /// Tavern room tone up (idempotent).
    TavernEnter,
    /// Tavern room tone down, over a 0.6 s fade.
    TavernExit,
}

/// The one audio context. `None` is a perfectly normal state — no device, a
/// browser that refused a context, or a boot that asked for silence — and
/// every method below is a no-op in it.
#[derive(Resource, Default)]
pub struct Audio {
    sfx: Option<Sfx>,
    muted: bool,
    volume: f32,
}

impl Audio {
    /// Fire a patch directly. Prefer raising a [`SfxEvent`]; this exists for
    /// the call sites that need the scheduled form (`Patch::LevelStart` with
    /// a lookahead).
    pub fn play(&self, patch: Patch) {
        if let Some(sfx) = &self.sfx {
            sfx.play(patch);
        }
    }

    /// The audio clock in seconds, or 0 when there is no context. Schedule
    /// against THIS, never against frame time.
    pub fn now(&self) -> f64 {
        self.sfx.as_ref().map(|s| s.now()).unwrap_or(0.0)
    }

    pub fn is_muted(&self) -> bool {
        self.muted
    }

    pub fn volume(&self) -> f32 {
        self.volume
    }

    /// Mute is a GATE, not a volume: the level is kept independently so
    /// turning sound off and back on restores what the player chose rather
    /// than jumping to full.
    pub fn set_muted(&mut self, muted: bool) {
        self.muted = muted;
        self.apply();
    }

    pub fn set_volume(&mut self, volume: f32) {
        self.volume = volume.clamp(0.0, 1.0);
        self.apply();
    }

    fn apply(&self) {
        if let Some(sfx) = &self.sfx {
            sfx.set_master(self.muted, self.volume);
        }
    }
}

/// Wires the audio context, the message drain and the wasm gesture unlock.
pub struct SfxPlugin;

impl Plugin for SfxPlugin {
    fn build(&self, app: &mut App) {
        let muted = muted_at_boot();
        let volume = 1.0;
        app.add_message::<SfxEvent>()
            .insert_resource(Audio {
                // Fail-silent: `Sfx::new` returns `None` rather than panicking,
                // so a box with no output device still boots the game.
                sfx: Sfx::new(muted, volume),
                muted,
                volume,
            })
            .add_systems(Update, (unlock_on_first_gesture, drain_sfx_messages));
    }
}

/// Boot-time silence.
///
/// Mirrors `tavern_boot_gate()` in `tavern.rs`: a native flag/env pair, and a
/// wasm query param read through `js_sys::eval`. `playtest=1` is muted for the
/// same reason the legacy app silences it globally — an automated run must not
/// make noise on whatever machine it is driving.
fn muted_at_boot() -> bool {
    #[cfg(target_arch = "wasm32")]
    {
        js_sys::eval("location.search")
            .ok()
            .and_then(|v| v.as_string())
            .map(|s| s.contains("mute=1") || s.contains("playtest=1"))
            .unwrap_or(false)
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        std::env::args().any(|a| a == "--mute")
            || std::env::var("PK_MUTE").map(|v| v == "1").unwrap_or(false)
    }
}

/// Browsers keep an `AudioContext` suspended until a user gesture, so the
/// first key or click has to resume it or nothing is ever audible.
///
/// Runs once and then latches: `resume()` on an already-running context is
/// harmless, but a `Local` flag keeps this off the hot path for the rest of
/// the session. No-op natively — the resume is a backend no-op there.
fn unlock_on_first_gesture(
    mut unlocked: Local<bool>,
    audio: Res<Audio>,
    keys: Res<ButtonInput<KeyCode>>,
    mouse: Res<ButtonInput<MouseButton>>,
) {
    if *unlocked {
        return;
    }
    let gestured =
        keys.get_just_pressed().next().is_some() || mouse.get_just_pressed().next().is_some();
    if !gestured {
        return;
    }
    *unlocked = true;
    if let Some(sfx) = &audio.sfx {
        sfx.resume();
    }
}

/// The one drain. Muted contexts still consume the messages (a queue that
/// grows while muted would dump every banked sting the moment sound came back).
fn drain_sfx_messages(mut messages: MessageReader<SfxEvent>, audio: Res<Audio>) {
    let Some(sfx) = &audio.sfx else {
        // No context: still drain, so nothing accumulates.
        messages.clear();
        return;
    };
    for message in messages.read() {
        match message {
            SfxEvent::StationFocus => sfx.play(Patch::StationFocus),
            SfxEvent::KeeperGreet => sfx.play(Patch::KeeperGreet),
            SfxEvent::Plunger => sfx.play(Patch::Plunger),
            SfxEvent::Anvil => sfx.play(Patch::Anvil),
            // The pitch jitter is rolled inside the patch layer, so the RNG
            // lives in one place instead of at every call site.
            SfxEvent::Roll => sfx.play(Patch::roll()),
            SfxEvent::Break => sfx.play(Patch::Break),
            SfxEvent::Coin => sfx.play(Patch::Coin),
            SfxEvent::Bumper => sfx.play(Patch::bumper()),
            SfxEvent::LevelStart => sfx.play(Patch::level_start()),
            SfxEvent::TavernEnter => sfx.bed_start(),
            SfxEvent::TavernExit => sfx.bed_stop(),
        }
    }
}
