//! Pixel snapping. Both the camera and the sprites land on the same lattice,
//! and the lattice is the camera's own right/up basis — snapping world axes
//! under a 45° yaw is the documented way to get judder instead of stillness
//! (legacy `engine/camera.ts:142-171`, `scenes/tavern/player.ts:66-113`).

use bevy::prelude::*;

pub struct SnapPlugin;

impl Plugin for SnapPlugin {
    fn build(&self, _app: &mut App) {}
}
