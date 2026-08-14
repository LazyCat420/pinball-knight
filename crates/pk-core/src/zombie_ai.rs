//! Live enemy simulation, flow-field steering, and attack state machine.
//!
//! Port of `legacy/src/game/pinball-knight/entities/zombie.ts` (1,218 lines).
//!
//! Handles:
//! - 60 Hz downhill flow-field steering towards player
//! - Close-range direct vector steering
//! - Pairwise enemy separation forces
//! - Attack windup, strike, and cooldown cycles
//! - Stagger and pain interruptions
//!
//! PORTS: `entities/zombie.ts`

use crate::collide::move_circle;
use crate::enemies::*;
use crate::flow_field::flow_step;
use crate::grid::{tile_center, world_to_tile, Grid};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EnemyMode {
    Wander,
    Chase,
    Windup,
    Attack,
    Stagger,
    Dead,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LiveEnemy {
    pub id: u32,
    pub kind_str: String,
    pub x: f64,
    pub z: f64,
    pub vx: f64,
    pub vz: f64,
    pub radius: f64,
    pub hp: f64,
    pub max_hp: f64,
    pub speed: f64,
    pub mode: EnemyMode,
    pub windup_t: f64,
    pub attack_cd: f64,
    pub stagger_t: f64,
    pub contact_range: f64,
    pub windup_duration: f64,
    pub cooldown_duration: f64,
    pub damage: i32,
}

impl LiveEnemy {
    pub fn new_zombie(id: u32, x: f64, z: f64) -> Self {
        Self {
            id,
            kind_str: "zombie".to_string(),
            x,
            z,
            vx: 0.0,
            vz: 0.0,
            radius: ZOMBIE_R,
            hp: ZOMBIE_HP as f64,
            max_hp: ZOMBIE_HP as f64,
            speed: 1.6,
            mode: EnemyMode::Chase,
            windup_t: 0.0,
            attack_cd: 0.0,
            stagger_t: 0.0,
            contact_range: 0.65,
            windup_duration: ZOMBIE_ATTACK_WINDUP,
            cooldown_duration: ZOMBIE_ATTACK_COOLDOWN,
            damage: ZOMBIE_DAMAGE,
        }
    }

    pub fn new_brute(id: u32, x: f64, z: f64) -> Self {
        Self {
            id,
            kind_str: "brute".to_string(),
            x,
            z,
            vx: 0.0,
            vz: 0.0,
            radius: BRUTE_R,
            hp: BRUTE_HP as f64,
            max_hp: BRUTE_HP as f64,
            speed: 1.6 * BRUTE_SPEED_FACTOR,
            mode: EnemyMode::Chase,
            windup_t: 0.0,
            attack_cd: 0.0,
            stagger_t: 0.0,
            contact_range: BRUTE_CONTACT_RANGE,
            windup_duration: BRUTE_ATTACK_WINDUP,
            cooldown_duration: BRUTE_ATTACK_COOLDOWN,
            damage: BRUTE_DAMAGE,
        }
    }

    pub fn update(
        &mut self,
        dt: f64,
        player_x: f64,
        player_z: f64,
        flow_distances: &[i32],
        grid: &Grid,
    ) {
        if self.mode == EnemyMode::Dead {
            return;
        }

        // 1. Tick timers
        if self.attack_cd > 0.0 {
            self.attack_cd = (self.attack_cd - dt).max(0.0);
        }
        if self.stagger_t > 0.0 {
            self.stagger_t = (self.stagger_t - dt).max(0.0);
            if self.stagger_t == 0.0 && self.mode == EnemyMode::Stagger {
                self.mode = EnemyMode::Chase;
            }
            return; // Stagger freezes motion
        }

        let dx = player_x - self.x;
        let dz = player_z - self.z;
        let dist = (dx * dx + dz * dz).sqrt();

        // 2. Attack State Machine
        match self.mode {
            EnemyMode::Windup => {
                self.windup_t -= dt;
                if self.windup_t <= 0.0 {
                    self.mode = EnemyMode::Attack;
                }
            }
            EnemyMode::Attack => {
                // Strike executes
                self.attack_cd = self.cooldown_duration;
                self.mode = EnemyMode::Chase;
            }
            EnemyMode::Chase | EnemyMode::Wander => {
                if dist <= self.contact_range && self.attack_cd <= 0.0 {
                    self.mode = EnemyMode::Windup;
                    self.windup_t = self.windup_duration;
                    return;
                }

                // 3. Movement Steering
                let (dir_x, dir_z) = if dist < DIRECT_STEER_RANGE {
                    // Direct vector steering
                    if dist > 1e-4 {
                        (dx / dist, dz / dist)
                    } else {
                        (0.0, 0.0)
                    }
                } else {
                    // Flow field downhill step
                    let (ti, tj) = world_to_tile(grid, self.x, self.z);
                    if let Some((next_i, next_j)) = flow_step(grid, flow_distances, ti, tj) {
                        let (tc_x, tc_z) = tile_center(grid, next_i, next_j);
                        let tdx = tc_x - self.x;
                        let tdz = tc_z - self.z;
                        let tlen = (tdx * tdx + tdz * tdz).sqrt();
                        if tlen > 1e-4 {
                            (tdx / tlen, tdz / tlen)
                        } else {
                            (0.0, 0.0)
                        }
                    } else if dist > 1e-4 {
                        (dx / dist, dz / dist)
                    } else {
                        (0.0, 0.0)
                    }
                };

                let target_vx = dir_x * self.speed;
                let target_vz = dir_z * self.speed;

                // Smooth steering acceleration
                let blend = 8.0 * dt;
                self.vx += (target_vx - self.vx) * blend.min(1.0);
                self.vz += (target_vz - self.vz) * blend.min(1.0);

                // Circle collision step
                let res = move_circle(grid, self.x, self.z, self.radius, self.vx * dt, self.vz * dt);
                self.x = res.x;
                self.z = res.z;
            }
            _ => {}
        }
    }
}

/// Applies pairwise separation force to prevent horde stacking.
pub fn apply_enemy_separation(enemies: &mut [LiveEnemy], dt: f64) {
    let len = enemies.len();
    let separation_radius = 0.65;
    let push_strength = 2.5;

    for i in 0..len {
        for j in (i + 1)..len {
            let dx = enemies[j].x - enemies[i].x;
            let dz = enemies[j].z - enemies[i].z;
            let dist_sq = dx * dx + dz * dz;

            if dist_sq < separation_radius * separation_radius && dist_sq > 1e-6 {
                let dist = dist_sq.sqrt();
                let overlap = (separation_radius - dist) * 0.5;
                let nx = dx / dist;
                let nz = dz / dist;

                enemies[i].x -= nx * overlap * push_strength * dt;
                enemies[i].z -= nz * overlap * push_strength * dt;
                enemies[j].x += nx * overlap * push_strength * dt;
                enemies[j].z += nz * overlap * push_strength * dt;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zombie_lifecycle_and_windup() {
        let mut z = LiveEnemy::new_zombie(1, 10.0, 10.0);
        let grid = Grid::solid(25, 25);
        let flow_distances = vec![10; 625];

        // Player within contact range
        z.update(0.016, 10.2, 10.0, &flow_distances, &grid);
        assert_eq!(z.mode, EnemyMode::Windup);

        // Advance past windup duration
        z.update(z.windup_duration + 0.01, 10.2, 10.0, &flow_distances, &grid);
        assert_eq!(z.mode, EnemyMode::Attack);
    }
}
