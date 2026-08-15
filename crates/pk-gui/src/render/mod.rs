//! Scene rendering helpers: arc-lanes, arc-kickers, light crossing model, aim indicator, palette shading, monster portraits, palette sources, paint types, and tell clips.
//!
//! PORTS: `render/arc-lanes.ts`, `render/arc-kickers.ts`, `render/light-crossing.ts`, `render/aim-indicator.ts`, `render/palette-shading.ts`, `render/monster-portrait.ts`, `engine/palette-source.ts`, `engine/render/paint-types.ts`, `render/tell-clips.ts`

pub mod aim_indicator;
pub mod arc_kickers;
pub mod arc_lanes;
pub mod light_crossing;
pub mod monster_portrait;
pub mod paint_types;
pub mod palette_shading;
pub mod palette_source;
pub mod tell_clips;

pub use aim_indicator::*;
pub use arc_kickers::*;
pub use arc_lanes::*;
pub use light_crossing::*;
pub use monster_portrait::*;
pub use paint_types::*;
pub use palette_shading::*;
pub use palette_source::*;
pub use tell_clips::*;
