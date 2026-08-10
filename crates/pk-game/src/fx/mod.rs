//! ✨ PARTICLES — the tavern's embers, motes and sparks.
//!
//! Port of `legacy/src/game/pinball-knight/fx/pools/particle-pool.ts`: a CPU
//! ring-buffer pool whose live slots are uploaded to one instanced additive
//! material each frame. The tavern spawns exactly three kinds; the same pool
//! serves the dungeon when its FX land.

use bevy::prelude::*;

/// Wires the pool, the spawners and the upload.
pub struct FxPlugin;

impl Plugin for FxPlugin {
    fn build(&self, _app: &mut App) {}
}
