//! Ghost phasing movement and vulnerability state.
//!
//! PORTS-PARTIAL: `entities/zombie.ts` - NOT a finished port - 0 of 5 exported names carried over (0%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

use super::types::{EnemyMode, LiveMonster};
use crate::enemies::*;
use crate::grid::Grid;

/// Advances ghost phasing simulation through walls and bobbing animation.
pub fn step_ghost(
    m: &mut LiveMonster,
    grid: &Grid,
    player_x: f64,
    player_z: f64,
    dt: f64,
) {
    m.bob_t += dt;

    if m.vuln_t > 0.0 {
        m.vuln_t = (m.vuln_t - dt).max(0.0);
    }

    if m.mode == EnemyMode::Dead {
        return;
    }

    let dx = player_x - m.x;
    let dz = player_z - m.z;
    let dist = (dx * dx + dz * dz).sqrt();

    // Ghosts steer directly toward the player, phasing through walls
    if dist > 1e-4 {
        let dir_x = dx / dist;
        let dir_z = dz / dist;
        m.vx = dir_x * m.speed;
        m.vz = dir_z * m.speed;
    }

    m.x += m.vx * dt;
    m.z += m.vz * dt;

    // Clamp inside grid boundaries
    let half_w = f64::from(grid.w) / 2.0 - 0.2;
    let half_h = f64::from(grid.h) / 2.0 - 0.2;
    m.x = m.x.clamp(-half_w, half_w);
    m.z = m.z.clamp(-half_h, half_h);
}

pub fn ghost_hover_offset(m: &LiveMonster) -> f64 {
    GHOST_HOVER_Y + (m.bob_t * GHOST_BOB_SPEED).sin() * GHOST_BOB_AMP
}
