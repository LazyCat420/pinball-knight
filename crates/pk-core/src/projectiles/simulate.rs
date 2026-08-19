//! 60 Hz projectile integration and boundary physics.
//!
//! PORTS: `entities/projectiles.ts`

use super::types::Projectile;
use crate::grid::{world_to_tile, Grid, T_WALL};

/// Advance a projectile collection by `dt` against world grid bounds.
pub fn step_projectiles_sim(projectiles: &mut Vec<Projectile>, grid: &Grid, dt: f64) {
    for p in projectiles.iter_mut() {
        if p.dead {
            continue;
        }
        p.life -= dt;
        if p.life <= 0.0 {
            p.dead = true;
            continue;
        }

        // Apply curve acceleration if active
        if p.curve_rate != 0.0 {
            let speed = (p.vx * p.vx + p.vz * p.vz).sqrt();
            let angle = p.vz.atan2(p.vx) + p.curve_rate * dt;
            p.vx = angle.cos() * speed;
            p.vz = angle.sin() * speed;
        }

        p.x += p.vx * dt;
        p.z += p.vz * dt;

        // Wall collision check
        let (ti, tj) = world_to_tile(grid, p.x, p.z);
        if ti < 0 || ti >= grid.w || tj < 0 || tj >= grid.h {
            p.dead = true;
            continue;
        }
        let tile = grid.t[(tj * grid.w + ti) as usize];
        if tile == T_WALL {
            p.dead = true;
        }
    }

    projectiles.retain(|p| !p.dead);
}
