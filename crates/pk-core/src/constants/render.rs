//! Unified render pipeline constants, sorting rungs, and lighting parameters.
//!
//! PORTS-PARTIAL: `constants/render.ts` - NOT a finished port - 0 of 69 exported names carried over (0%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

pub const DESIGN_VIEWPORT_W: f64 = 640.0;
pub const DESIGN_VIEWPORT_H: f64 = 360.0;
pub const ASPECT_RATIO: f64 = 16.0 / 9.0;

// Render layer sorting rungs
pub const RUNG_BACKGROUND: i32 = 0;
pub const RUNG_FLOOR: i32 = 1;
pub const RUNG_DECALS: i32 = 2;
pub const RUNG_SHADOWS: i32 = 3;
pub const RUNG_FLOOR_FX: i32 = 4;
pub const RUNG_WALLS: i32 = 5;
pub const RUNG_ENTITIES: i32 = 6;
pub const RUNG_PROJECTILES: i32 = 7;
pub const RUNG_VFX: i32 = 8;
pub const RUNG_POST_PROCESS: i32 = 9;
pub const RUNG_GUI: i32 = 10;
pub const RUNG_NOTIFICATION: i32 = 11;

// Lighting and shading constants
pub const LIGHT_AMBIENT_DEFAULT: [f32; 3] = [0.15, 0.18, 0.25];
pub const LIGHT_TORCH_COLOR: [f32; 3] = [1.0, 0.65, 0.2];
pub const LIGHT_FALLOFF_LINEAR: f32 = 0.09;
pub const LIGHT_FALLOFF_QUADRATIC: f32 = 0.032;

/// Calculates 2D distance attenuation factor for a point light source.
pub fn calculate_light_attenuation(dist: f32, radius: f32) -> f32 {
    if dist >= radius {
        return 0.0;
    }
    let d = dist / radius;
    let denom = 1.0 + LIGHT_FALLOFF_LINEAR * d + LIGHT_FALLOFF_QUADRATIC * d * d;
    ((1.0 - d * d) / denom).max(0.0)
}
