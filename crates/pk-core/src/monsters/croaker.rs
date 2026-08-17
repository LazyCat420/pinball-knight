//! Croaker (Frog) hop leaps and corpse acid explosion.
//!
//! PORTS: `render/monsters/croaker.ts`
//! PORTS-PARTIAL: `entities/zombie.ts` - NOT a finished port - 0 of 5 exported names carried over (0%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

use super::types::{EnemyMode, LiveMonster};
use crate::enemies::*;
use crate::grid::{is_low_wall, world_to_tile, Grid, T_WALL};

pub const CROAKER_ACID_RADIUS: f64 = 2.0;
pub const CROAKER_ACID_DAMAGE: i32 = 15;

/// Advances croaker hopping physics and low-wall traversal.
pub fn step_croaker_hop(
    m: &mut LiveMonster,
    grid: &Grid,
    player_x: f64,
    player_z: f64,
    dt: f64,
) {
    if m.hop_cd > 0.0 {
        m.hop_cd = (m.hop_cd - dt).max(0.0);
    }

    let dx = player_x - m.x;
    let dz = player_z - m.z;
    let dist = (dx * dx + dz * dz).sqrt();

    if m.mode == EnemyMode::Hop {
        m.hop_t -= dt;
        if m.hop_t <= 0.0 {
            m.mode = EnemyMode::Chase;
            m.hop_cd = CROAKER_HOP_CD;
            return;
        }

        // Steer while airborne
        let new_x = m.x + m.vx * dt;
        let new_z = m.z + m.vz * dt;

        let (ti, tj) = world_to_tile(grid, new_x, new_z);
        if ti >= 0 && ti < grid.w && tj >= 0 && tj < grid.h {
            let is_wall = grid.t[(tj * grid.w + ti) as usize] == T_WALL;
            if is_wall {
                if is_low_wall(grid, ti, tj) {
                    // Rule 1: Airborne crosses knee-high camera-side rim
                    m.x = new_x;
                    m.z = new_z;
                } else {
                    // Rule 2: Airborne bounces off full-height masonry
                    if m.hop_bounces > 0 {
                        m.hop_bounces -= 1;
                        m.vx = -m.vx * 0.8;
                        m.vz = -m.vz * 0.8;
                    } else {
                        m.vx = 0.0;
                        m.vz = 0.0;
                    }
                }
            } else {
                m.x = new_x;
                m.z = new_z;
            }
        }

        // Clamp inside grid boundaries
        let half_w = f64::from(grid.w) / 2.0 - 0.2;
        let half_h = f64::from(grid.h) / 2.0 - 0.2;
        m.x = m.x.clamp(-half_w, half_w);
        m.z = m.z.clamp(-half_h, half_h);
    } else if m.mode == EnemyMode::Chase && m.hop_cd <= 0.0 && dist > CROAKER_HOP_MIN_RANGE {
        // Trigger hop leap
        m.mode = EnemyMode::Hop;
        m.hop_t = CROAKER_HOP_TIME;
        m.hop_bounces = CROAKER_HOP_BOUNCES;
        if dist > 1e-4 {
            m.vx = (dx / dist) * CROAKER_HOP_SPEED;
            m.vz = (dz / dist) * CROAKER_HOP_SPEED;
        }
    }
}
