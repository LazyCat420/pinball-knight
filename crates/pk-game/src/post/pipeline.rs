//! The bloom chain and the composite, as render-graph nodes on the scene
//! camera. Straight port of `pixel-pass.ts`'s `render()` and `finalNode`.

use bevy::prelude::*;

pub struct PixelPipelinePlugin;

impl Plugin for PixelPipelinePlugin {
    fn build(&self, _app: &mut App) {}
}
