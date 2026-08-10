//! 🖼 THE PIXEL PASS — the port of `legacy/src/game/pinball-knight/engine/
//! render/pixel-pass.ts`, the thing that makes this game look like a game and
//! not like flat 3D.
//!
//! The chain, in the order the oracle runs it (ORDER IS THE LOOK):
//!   scene → low-res linear target → half-res bloom → one composite
//!   (SSAO → +bloom → linear→sRGB → vignette → CEL GRADE) → integer
//!   nearest upscale to the window.
//!
//! Live at the shipped legacy defaults: cel (10 steps, curve 0.5, saturation
//! 1.15), bloom (threshold 0.7, strength 0.9, radius 2.2), AO 0.85 / radius
//! 14, vignette 0.32. The oracle's own config leaves palette quantize,
//! dither, scanlines, ink outline, heat and chromatic aberration OFF, so not
//! porting them is parity-neutral rather than visual debt — their uniforms
//! exist pinned at 0 so turning one on later is a flip and a filled stub,
//! never a reorder.

use bevy::prelude::*;

pub mod pipeline;
pub mod sizing;
pub mod snap;

/// Wires the whole chain. Sub-plugins own their own camera queries so entry
/// order never matters (the same lazy-setup discipline as the scenes).
pub struct PostPlugin;

impl Plugin for PostPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<sizing::PixelSizing>()
            .add_plugins(sizing::SizingPlugin)
            .add_plugins(pipeline::PixelPipelinePlugin)
            .add_plugins(snap::SnapPlugin);
    }
}
