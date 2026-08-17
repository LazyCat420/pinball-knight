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
//! - Movement policy lookup per enemy kind / zombie sub-type
//! - World velocity to screen facing resolution
//!
//! PORTS: `entities/zombie.ts`

use crate::collide::move_circle;
use crate::enemies::*;
use crate::flow_field::flow_step;
use crate::grid::{tile_center, world_to_tile, Grid};
use crate::monsters::types::EnemyKind;
use crate::state::{Facing, SimState};
use crate::zombie_types::ZombieType;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EnemyStats {
    pub body_r: f64,
    pub contact_range: f64,
    pub windup: f64,
    pub cooldown: f64,
    pub ranged: bool,
}

pub fn stats_for_kind(kind: EnemyKind) -> EnemyStats {
    match kind {
        EnemyKind::Zombie => EnemyStats {
            body_r: ZOMBIE_R,
            contact_range: ZOMBIE_CONTACT_RANGE,
            windup: ZOMBIE_ATTACK_WINDUP,
            cooldown: ZOMBIE_ATTACK_COOLDOWN,
            ranged: false,
        },
        EnemyKind::Spider => EnemyStats {
            body_r: SPIDER_R,
            contact_range: SPIDER_CONTACT_RANGE,
            windup: SPIDER_ATTACK_WINDUP,
            cooldown: SPIDER_ATTACK_COOLDOWN,
            ranged: false,
        },
        EnemyKind::Brute => EnemyStats {
            body_r: BRUTE_R,
            contact_range: BRUTE_CONTACT_RANGE,
            windup: BRUTE_ATTACK_WINDUP,
            cooldown: BRUTE_ATTACK_COOLDOWN,
            ranged: false,
        },
        EnemyKind::Croaker => EnemyStats {
            body_r: CROAKER_R,
            contact_range: CROAKER_FIRE_RANGE,
            windup: CROAKER_WINDUP,
            cooldown: CROAKER_COOLDOWN,
            ranged: true,
        },
        EnemyKind::Bat => EnemyStats {
            body_r: BAT_R,
            contact_range: BAT_CONTACT_RANGE,
            windup: BAT_ATTACK_WINDUP,
            cooldown: BAT_ATTACK_COOLDOWN,
            ranged: false,
        },
        EnemyKind::Slime => EnemyStats {
            body_r: SLIME_R,
            contact_range: SLIME_CONTACT_RANGE,
            windup: SLIME_ATTACK_WINDUP,
            cooldown: SLIME_ATTACK_COOLDOWN,
            ranged: false,
        },
        EnemyKind::Ghost => EnemyStats {
            body_r: GHOST_R,
            contact_range: GHOST_CONTACT_RANGE,
            windup: GHOST_ATTACK_WINDUP,
            cooldown: GHOST_ATTACK_COOLDOWN,
            ranged: false,
        },
        EnemyKind::Reaper => EnemyStats {
            body_r: GHOST_R,
            contact_range: REAPER_CONTACT_RANGE,
            windup: REAPER_ATTACK_WINDUP,
            cooldown: REAPER_ATTACK_COOLDOWN,
            ranged: false,
        },
        EnemyKind::Golem => EnemyStats {
            body_r: GOLEM_R,
            contact_range: GOLEM_CONTACT_RANGE,
            windup: GOLEM_ATTACK_WINDUP,
            cooldown: GOLEM_ATTACK_COOLDOWN,
            ranged: false,
        },
        EnemyKind::Chomper => EnemyStats {
            body_r: CHOMPER_R,
            contact_range: CHOMPER_CONTACT_RANGE,
            windup: CHOMPER_ATTACK_WINDUP,
            cooldown: CHOMPER_ATTACK_COOLDOWN,
            ranged: false,
        },
        EnemyKind::Jester => EnemyStats {
            body_r: JESTER_R,
            contact_range: JESTER_FIRE_RANGE,
            windup: JESTER_WINDUP,
            cooldown: JESTER_COOLDOWN,
            ranged: true,
        },
        EnemyKind::Rotortail => EnemyStats {
            body_r: ROTORTAIL_R,
            contact_range: ROTORTAIL_FIRE_RANGE,
            windup: ROTORTAIL_WINDUP,
            cooldown: ROTORTAIL_COOLDOWN,
            ranged: true,
        },
        EnemyKind::Stiltneck => EnemyStats {
            body_r: STILTNECK_R,
            contact_range: STILTNECK_FIRE_RANGE,
            windup: STILTNECK_WINDUP,
            cooldown: STILTNECK_COOLDOWN,
            ranged: true,
        },
        _ => EnemyStats {
            body_r: ZOMBIE_R,
            contact_range: ZOMBIE_CONTACT_RANGE,
            windup: ZOMBIE_ATTACK_WINDUP,
            cooldown: ZOMBIE_ATTACK_COOLDOWN,
            ranged: false,
        },
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MovementKind {
    Direct,
    Flank,
    Ambush,
    Leap,
    Swarm,
    Hover,
    Stationary,
}

/// Resolves the movement steering policy for an enemy actor.
pub fn movement_of(kind: EnemyKind, ztype: Option<ZombieType>) -> MovementKind {
    if let Some(zt) = ztype {
        match zt {
            ZombieType::Runner => MovementKind::Flank,
            ZombieType::Crawler => MovementKind::Ambush,
            ZombieType::Flailer => MovementKind::Leap,
            ZombieType::Midget => MovementKind::Swarm,
            _ => MovementKind::Direct,
        }
    } else {
        match kind {
            EnemyKind::Ghost | EnemyKind::Bat | EnemyKind::Rotortail => MovementKind::Hover,
            EnemyKind::Jester | EnemyKind::Croaker => MovementKind::Leap,
            _ => MovementKind::Direct,
        }
    }
}

pub const ISO_COS: f64 = 0.7071067811865476;

/// Converts world direction vector into screen-relative facing matching isometric projection.
pub fn facing_from_world(wx: f64, wz: f64, fallback: Facing) -> Facing {
    let sx = wx * ISO_COS - wz * ISO_COS;
    let sz = -(wx * ISO_COS + wz * ISO_COS);
    facing_from_velocity(sx, sz, fallback)
}

pub fn facing_from_velocity(vx: f64, vz: f64, fallback: Facing) -> Facing {
    let ax = vx.abs();
    let az = vz.abs();
    if ax < 1e-4 && az < 1e-4 {
        return fallback;
    }
    let vertical = matches!(fallback, Facing::S | Facing::N);
    let margin = 1.25;
    if vertical && az * margin >= ax && az >= 1e-4 {
        return if vz > 0.0 { Facing::S } else { Facing::N };
    }
    if !vertical && ax * margin >= az && ax >= 1e-4 {
        return if vx > 0.0 { Facing::E } else { Facing::W };
    }
    if az >= ax {
        if vz > 0.0 {
            Facing::S
        } else {
            Facing::N
        }
    } else if vx > 0.0 {
        Facing::E
    } else {
        Facing::W
    }
}

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
        px: f64,
        pz: f64,
        flow_distances: &[i32],
        grid: &Grid,
    ) {
        if self.hp <= 0.0 {
            self.mode = EnemyMode::Dead;
            return;
        }

        if self.stagger_t > 0.0 {
            self.stagger_t -= dt;
            self.mode = EnemyMode::Stagger;
            let m_res = move_circle(grid, self.x, self.z, self.radius, self.vx * dt, self.vz * dt);
            self.x = m_res.x;
            self.z = m_res.z;
            self.vx *= 0.85;
            self.vz *= 0.85;
            return;
        }

        let dx = px - self.x;
        let dz = pz - self.z;
        let dist = (dx * dx + dz * dz).sqrt();

        if self.attack_cd > 0.0 {
            self.attack_cd = (self.attack_cd - dt).max(0.0);
        }

        match self.mode {
            EnemyMode::Windup => {
                self.windup_t += dt;
                if self.windup_t >= self.windup_duration {
                    self.mode = EnemyMode::Attack;
                    self.windup_t = 0.0;
                }
            }
            EnemyMode::Attack => {
                self.attack_cd = self.cooldown_duration;
                self.mode = EnemyMode::Chase;
            }
            EnemyMode::Chase | EnemyMode::Wander => {
                if dist <= self.contact_range && self.attack_cd <= 0.0 {
                    self.mode = EnemyMode::Windup;
                    self.windup_t = 0.0;
                    return;
                }

                let (tx, tz) = if dist < 2.0 {
                    (dx / dist.max(1e-4), dz / dist.max(1e-4))
                } else {
                    let tile = world_to_tile(grid, self.x, self.z);
                    if let Some((next_x, next_z)) = flow_step(grid, flow_distances, tile.0, tile.1) {
                        let center = tile_center(grid, next_x, next_z);
                        let fdx = center.0 - self.x;
                        let fdz = center.1 - self.z;
                        let flen = (fdx * fdx + fdz * fdz).sqrt();
                        if flen > 1e-4 {
                            (fdx / flen, fdz / flen)
                        } else {
                            (dx / dist.max(1e-4), dz / dist.max(1e-4))
                        }
                    } else {
                        (dx / dist.max(1e-4), dz / dist.max(1e-4))
                    }
                };

                let target_vx = tx * self.speed;
                let target_vz = tz * self.speed;
                let blend = (dt * 10.0).min(1.0);
                self.vx += (target_vx - self.vx) * blend;
                self.vz += (target_vz - self.vz) * blend;

                let m_res = move_circle(grid, self.x, self.z, self.radius, self.vx * dt, self.vz * dt);
                self.x = m_res.x;
                self.z = m_res.z;
            }
            _ => {}
        }
    }
}

/// Advances all live zombies in the simulation state by dt.
pub fn update_zombies(sim_state: &mut SimState, dt: f64) {
    let px = sim_state.player.x;
    let pz = sim_state.player.z;
    let grid = &sim_state.grid;

    for m in sim_state.monsters.iter_mut() {
        let dx = px - m.x;
        let dz = pz - m.z;
        let dist = (dx * dx + dz * dz).sqrt();
        if dist > 1e-4 {
            let speed = m.speed;
            m.vx = (dx / dist) * speed;
            m.vz = (dz / dist) * speed;
            let m_res = move_circle(grid, m.x, m.z, m.radius, m.vx * dt, m.vz * dt);
            m.x = m_res.x;
            m.z = m_res.z;
        }
    }
}

pub fn apply_enemy_separation(enemies: &mut [LiveEnemy], separation_radius: f64, push_strength: f64, dt: f64) {
    let len = enemies.len();
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
