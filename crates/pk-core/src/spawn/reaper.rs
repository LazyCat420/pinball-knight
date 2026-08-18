//! Reaper King Boss Spawner — The unkillable stair guardian that drifts towards the player.
//!
//! PORTS: `spawn/reaper.ts`

pub const REAPER_DISTANCE_TILES: f32 = 12.0;
pub const REAPER_HP: f64 = 9999.0;
pub const REAPER_SCALE: f64 = 1.25;
pub const REAPER_SPEED_BASE: f64 = 2.2;
pub const REAPER_TINT: u32 = 0x8a1f28;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ReaperParams {
    pub hp: f64,
    pub scale: f64,
    pub speed_base: f64,
    pub tint: u32,
    pub aggro: bool,
}

impl ReaperParams {
    pub fn default_params() -> Self {
        Self {
            hp: REAPER_HP,
            scale: REAPER_SCALE,
            speed_base: REAPER_SPEED_BASE,
            tint: REAPER_TINT,
            aggro: true,
        }
    }
}

/// Calculates the spawn position for the Reaper King 12 tiles out from the player at the given angle.
pub fn compute_reaper_spawn_pos(player_x: f32, player_z: f32, angle: f32) -> (f32, f32) {
    (
        player_x + angle.cos() * REAPER_DISTANCE_TILES,
        player_z + angle.sin() * REAPER_DISTANCE_TILES,
    )
}

pub fn spawn_reaper(player_x: f32, player_z: f32, angle: f32) -> (f32, f32, ReaperParams) {
    let (x, z) = compute_reaper_spawn_pos(player_x, player_z, angle);
    (x, z, ReaperParams::default_params())
}
