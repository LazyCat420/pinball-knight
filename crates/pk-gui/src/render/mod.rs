//! Scene rendering helpers: arc-lanes, arc-kickers, light crossing model, aim indicator, aim indicator geometry, palette shading, monster portraits, palette sources, paint types, tell clips, knight look, canvas backing, knight portrait layout, lazy reaper sheet cache, and atlas noise census.
//!
//! PORTS: `render/arc-lanes.ts`, `render/arc-kickers.ts`, `render/light-crossing.ts`, `render/aim-indicator.ts`, `render/palette-shading.ts`, `render/monster-portrait.ts`, `engine/palette-source.ts`, `engine/render/paint-types.ts`, `render/tell-clips.ts`, `render/knight-look.ts`, `engine/render/canvas-backing.ts`, `render/knight-portrait.ts`, `render/aim-indicator-math.ts`, `render/reaper-sheet.ts`, `render/atlas-census.ts`

pub mod aim_indicator;
pub mod aim_indicator_math;
pub mod arc_kickers;
pub mod arc_lanes;
pub mod atlas_census;
pub mod canvas_backing;
pub mod knight_look;
pub mod knight_portrait;
pub mod light_crossing;
pub mod monster_portrait;
pub mod paint_types;
pub mod palette_shading;
pub mod palette_source;
pub mod reaper_sheet;
pub mod tell_clips;

pub use aim_indicator::*;
pub use aim_indicator_math::*;
pub use arc_kickers::*;
pub use arc_lanes::*;
pub use atlas_census::*;
pub use canvas_backing::*;
pub use knight_look::*;
pub use knight_portrait::*;
pub use light_crossing::*;
pub use monster_portrait::*;
pub use paint_types::*;
pub use palette_shading::*;
pub use palette_source::*;
pub use reaper_sheet::*;
pub use tell_clips::*;
