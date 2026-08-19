//! Pinball Knight Bevy application library module exports.
//! PORTS-NOTHING (Rust engine crate structure)

use bevy::prelude::*;
use pk_core::state::SimState;

#[derive(Resource)]
pub struct Sim(pub SimState);

#[derive(Component, Debug, Clone, Copy)]
pub struct GhostAfterimage {
    pub lifetime: f32,
    pub max_lifetime: f32,
}

pub mod ball_anim;
pub mod coins_render;
pub mod combat_feedback;
pub mod mat_cache;
pub mod pinball_parts;
pub mod slash_render;
