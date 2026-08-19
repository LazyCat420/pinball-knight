//! Dungeon Scene Boot Plan — Centralized scene graph initialization, fog boundaries, and camera aiming.
//!
//! PORTS: `boot/scene.ts`

use crate::palette::PALETTE_HEX;

pub const FOG_NEAR: f32 = 14.0;
pub const FOG_FAR: f32 = 32.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DungeonSceneBootPlan {
    pub background_color: u32,
    pub fog_color: u32,
    pub fog_near: f32,
    pub fog_far: f32,
    pub initial_biome: usize,
    pub camera_aim: [f32; 3],
}

/// Prepares the initial scene initialization parameters for session launch.
pub fn create_dungeon_scene_plan() -> DungeonSceneBootPlan {
    DungeonSceneBootPlan {
        background_color: PALETTE_HEX[0],
        fog_color: PALETTE_HEX[0],
        fog_near: FOG_NEAR,
        fog_far: FOG_FAR,
        initial_biome: 0,
        camera_aim: [0.0, 0.5, 0.0],
    }
}

pub fn install_scene() -> DungeonSceneBootPlan {
    create_dungeon_scene_plan()
}
