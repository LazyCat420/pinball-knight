//! Stiltneck explosive bomb mechanics and blast physics.
//!
//! PORTS: `render/monsters/stiltneck.ts`

use super::types::{EnemyKind, LiveMonster};
use crate::enemies::*;
use crate::grid::{world_to_tile, Grid, T_WALL};

#[derive(Debug, Clone, PartialEq)]
pub struct StiltneckBomb {
    pub id: u64,
    pub x: f64,
    pub z: f64,
    pub vx: f64,
    pub vz: f64,
    pub fuse: f64,
    pub dead: bool,
}

impl StiltneckBomb {
    pub fn new(id: u64, x: f64, z: f64, dir_x: f64, dir_z: f64) -> Self {
        let len = (dir_x * dir_x + dir_z * dir_z).sqrt().max(1e-4);
        Self {
            id,
            x,
            z,
            vx: (dir_x / len) * 4.2,
            vz: (dir_z / len) * 4.2,
            fuse: STILTNECK_BOMB_FUSE,
            dead: false,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct BlastResult {
    pub player_damage: i32,
    pub player_knockback_x: f64,
    pub player_knockback_z: f64,
    pub monsters_hit: Vec<(u32, f64)>, // (monster id, damage dealt)
    pub screen_shake: f64,
}

/// Advance live bombs, checking fuse expiry, wall contact, and player collision.
pub fn step_stiltneck_bombs(
    bombs: &mut Vec<StiltneckBomb>,
    grid: &Grid,
    player_x: f64,
    player_z: f64,
    dt: f64,
) -> Vec<(f64, f64)> {
    let mut detonations = Vec::new();

    for b in bombs.iter_mut() {
        if b.dead {
            continue;
        }
        b.fuse -= dt;
        b.x += b.vx * dt;
        b.z += b.vz * dt;

        let (ti, tj) = world_to_tile(grid, b.x, b.z);
        let hit_wall = if ti >= 0 && ti < grid.w && tj >= 0 && tj < grid.h {
            grid.t[(tj * grid.w + ti) as usize] == T_WALL
        } else {
            true
        };

        let dx = player_x - b.x;
        let dz = player_z - b.z;
        let hit_player = (dx * dx + dz * dz).sqrt() < 0.4;

        if b.fuse <= 0.0 || hit_wall || hit_player {
            b.dead = true;
            detonations.push((b.x, b.z));
        }
    }

    bombs.retain(|b| !b.dead);
    detonations
}

/// Resolves radial bomb detonation against player and monster horde.
pub fn resolve_bomb_blast(
    blast_x: f64,
    blast_z: f64,
    player_x: f64,
    player_z: f64,
    player_iframes: f64,
    monsters: &mut [LiveMonster],
) -> BlastResult {
    let mut res = BlastResult {
        screen_shake: 0.35,
        ..Default::default()
    };

    // 1. Horde Damage: Indiscriminate friendly-fire across full blast radius
    for m in monsters.iter_mut() {
        if !m.is_alive() || m.kind == EnemyKind::Reaper {
            continue; // Reapers and corpses are immune
        }

        let mdx = m.x - blast_x;
        let mdz = m.z - blast_z;
        let mdist = (mdx * mdx + mdz * mdz).sqrt();

        if mdist <= STILTNECK_BLAST_RADIUS {
            let dmg = f64::from(STILTNECK_BLAST_ENEMY_DAMAGE);
            m.hp = (m.hp - dmg).max(0.0);
            if m.hp <= 0.0 {
                m.mode = super::types::EnemyMode::Dead;
            }
            if mdist > 1e-4 {
                let push = STILTNECK_BLAST_PUSH * (1.0 - mdist / STILTNECK_BLAST_RADIUS);
                m.vx += (mdx / mdist) * push;
                m.vz += (mdz / mdist) * push;
            }
            res.monsters_hit.push((m.id, dmg));
        }
    }

    // 2. Player Damage: Distance falloff from center to rim
    let pdx = player_x - blast_x;
    let pdz = player_z - blast_z;
    let pdist = (pdx * pdx + pdz * pdz).sqrt();

    if pdist <= STILTNECK_BLAST_RADIUS {
        if player_iframes <= 0.0 {
            let t = (pdist / STILTNECK_BLAST_RADIUS).clamp(0.0, 1.0);
            // Falloff: dead centre = full damage, rim = minimum 1
            let base_dmg = STILTNECK_BLAST_DAMAGE;
            let falloff_dmg = ((1.0 - t * 0.7) * f64::from(base_dmg)).round() as i32;
            res.player_damage = falloff_dmg.max(1);
        }
        if pdist > 1e-4 {
            let push = STILTNECK_BLAST_PUSH * (1.0 - pdist / STILTNECK_BLAST_RADIUS);
            res.player_knockback_x = (pdx / pdist) * push;
            res.player_knockback_z = (pdz / pdist) * push;
        }
    }

    res
}
