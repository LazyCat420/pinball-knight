//! Pairwise spatial separation for monster hordes.
//!
//! PORTS: `entities/enemy-rules.ts`, `entities/zombie.ts`

use super::types::LiveMonster;

/// Applies pairwise separation force across all live monsters to prevent stacking.
pub fn apply_monster_separation(monsters: &mut [LiveMonster], dt: f64) {
    let len = monsters.len();
    let separation_radius = 0.65;
    let push_strength = 2.5;

    for i in 0..len {
        for j in (i + 1)..len {
            if !monsters[i].is_alive() || !monsters[j].is_alive() {
                continue;
            }

            let dx = monsters[j].x - monsters[i].x;
            let dz = monsters[j].z - monsters[i].z;
            let dist_sq = dx * dx + dz * dz;

            if dist_sq < separation_radius * separation_radius && dist_sq > 1e-6 {
                let dist = dist_sq.sqrt();
                let overlap = (separation_radius - dist) * 0.5;
                let nx = dx / dist;
                let nz = dz / dist;

                monsters[i].x -= nx * overlap * push_strength * dt;
                monsters[i].z -= nz * overlap * push_strength * dt;
                monsters[j].x += nx * overlap * push_strength * dt;
                monsters[j].z += nz * overlap * push_strength * dt;
            }
        }
    }
}
