//! 🔊 SOUND — the Bevy side of `pk_audio`.
//!
//! Everything is synthesized (house rule: the repo carries zero audio files).
//! Call sites raise a message; this module owns the one audio context.

use bevy::prelude::*;

/// Wires the audio context, the message drain and the wasm gesture unlock.
pub struct SfxPlugin;

impl Plugin for SfxPlugin {
    fn build(&self, _app: &mut App) {}
}
