//! Projectile hitbox testing and impact resolution.
//!
//! PORTS: `entities/projectiles.ts`, `entities/combat.ts`

use super::types::Projectile;
use crate::monsters::types::LiveMonster;

#[derive(Debug, Clone, PartialEq)]
pub struct ProjectileHit {
    pub projectile_id: u64,
    pub target_id: u32,
    pub damage: i32,
    pub hit_x: f64,
    pub hit_z: f64,
}

/// Checks player-fired projectiles against the monster horde.
pub fn check_player_projectile_hits(
    projectiles: &mut [Projectile],
    monsters: &mut [LiveMonster],
) -> Vec<ProjectileHit> {
    let mut hits = Vec::new();

    for p in projectiles.iter_mut() {
        if p.dead || !p.is_player {
            continue;
        }

        for m in monsters.iter_mut() {
            if !m.is_alive() {
                continue;
            }

            let dx = m.x - p.x;
            let dz = m.z - p.z;
            let r = m.radius + p.radius;

            if dx * dx + dz * dz <= r * r {
                hits.push(ProjectileHit {
                    projectile_id: p.id,
                    target_id: m.id,
                    damage: p.damage,
                    hit_x: p.x,
                    hit_z: p.z,
                });

                if p.pierce > 0 {
                    p.pierce -= 1;
                } else {
                    p.dead = true;
                    break;
                }
            }
        }
    }

    hits
}

/// Checks hostile enemy projectiles against the player.
pub fn check_enemy_projectile_hits(
    projectiles: &mut [Projectile],
    player_x: f64,
    player_z: f64,
    player_radius: f64,
    player_iframes: f64,
) -> Option<ProjectileHit> {
    for p in projectiles.iter_mut() {
        if p.dead || p.is_player {
            continue;
        }

        let dx = player_x - p.x;
        let dz = player_z - p.z;
        let r = player_radius + p.radius;

        if dx * dx + dz * dz <= r * r {
            p.dead = true;
            if player_iframes <= 0.0 {
                return Some(ProjectileHit {
                    projectile_id: p.id,
                    target_id: 0,
                    damage: p.damage,
                    hit_x: p.x,
                    hit_z: p.z,
                });
            }
        }
    }

    None
}
