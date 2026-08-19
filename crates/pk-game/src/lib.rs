//! Pinball Knight Bevy application library module exports.
//! PORTS-NOTHING (Rust engine crate structure)

use bevy::prelude::*;
use pk_core::state::SimState;

#[derive(Resource)]
pub struct Sim(pub SimState);

#[derive(Component, Debug, Clone, Copy, Default)]
pub struct DungeonCamera;

#[derive(States, Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum AppState {
    #[default]
    Intro,
    FloorLoading,
    Dungeon,
    Tavern,
}

#[derive(Component, Debug, Clone, Copy)]
pub struct GhostAfterimage {
    pub lifetime: f32,
    pub max_lifetime: f32,
}

pub mod animator;
pub mod ball_anim;
pub mod coins_render;
pub mod combat_feedback;
pub mod figure;
pub mod juice;
pub mod mat_cache;
pub mod pinball_parts;
pub mod post;
pub mod slash_render;
