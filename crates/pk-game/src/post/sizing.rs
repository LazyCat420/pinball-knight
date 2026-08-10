//! Render-size arithmetic, ported from `computeRenderSizing` /  `fitZoom`.
//! Pure functions + a resource; no Bevy types beyond the resource derive so
//! the port stays unit-testable against the oracle's measured tables.

use bevy::prelude::*;

/// legacy constants/render.ts — the reference floor, not a target size.
pub const RENDER_W: u32 = 1280;
pub const RENDER_H: u32 = 720;
/// Pixels per world unit at the shipped `wider` zoom rung.
pub const PPU: f32 = 56.0;

/// The live render lattice: how big the scene target is, and how many screen
/// pixels one of its texels covers.
#[derive(Resource, Debug, Clone, Copy, PartialEq, Eq)]
pub struct PixelSizing {
    pub render_w: u32,
    pub render_h: u32,
    pub scale: u32,
}

impl Default for PixelSizing {
    fn default() -> Self {
        Self {
            render_w: RENDER_W,
            render_h: RENDER_H,
            scale: 1,
        }
    }
}

/// Owns the scene render target, the present layer and the resize response.
pub struct SizingPlugin;

impl Plugin for SizingPlugin {
    fn build(&self, _app: &mut App) {}
}
