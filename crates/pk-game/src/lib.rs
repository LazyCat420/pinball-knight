//! Pinball Knight Bevy application library module exports.
//! PORTS-NOTHING (Rust engine crate structure)

use bevy::prelude::*;
use pk_core::state::SimState;

#[derive(Resource)]
pub struct Sim(pub SimState);

pub mod ball_anim;
pub mod coins_render;
pub mod combat_feedback;
pub mod slash_render;
