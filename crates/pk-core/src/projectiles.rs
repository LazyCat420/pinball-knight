//! Projectiles — bullets, arrows, flame puffs, and monster spells.
//!
//! Simulated on the fixed timestep (60 Hz): fly along ground direction at
//! `PROJECTILE_Y`, die against walls, connect against targets via combat damage.
//!
//! PORTS: `entities/projectiles.ts`

use crate::grid::{is_walkable, world_to_tile, Grid};

pub const PROJECTILE_Y: f64 = 0.42;
pub const MUZZLE_OFFSET: f64 = 0.35;
pub const HIT_R: f64 = 0.16;
pub const FLAME_BURN_IMMUNITY: f64 = 0.18;
pub const CURVE_ACCEL: f64 = 8.5;

// Enemy projectile stats
pub const SPITTER_GLOB_SPEED: f64 = 5.5;
pub const SPITTER_FIRE_RANGE: f64 = 7.0;
pub const SPITTER_DAMAGE: i32 = 12;

pub const WEB_GLOB_SPEED: f64 = 6.2;

pub const GOLEM_SHARDS: usize = 6;
pub const GOLEM_SHARD_SPEED: f64 = 4.8;
pub const GOLEM_SHARD_DAMAGE: i32 = 16;
pub const GOLEM_SHARD_LIFE: f64 = 1.2;

pub const JESTER_DISC_SPEED: f64 = 6.8;
pub const JESTER_DISC_DAMAGE: i32 = 14;
pub const JESTER_DISC_LIFE: f64 = 2.5;

pub const CROAKER_BEAM_SPEED: f64 = 9.0;
pub const CROAKER_BEAM_DAMAGE: i32 = 20;
pub const CROAKER_FIRE_RANGE: f64 = 8.5;
pub const CROAKER_BEAM_SPREAD: f64 = 0.22;

pub const ROTORTAIL_TIMBER_SPEED: f64 = 5.0;
pub const ROTORTAIL_TIMBER_DAMAGE: i32 = 18;
pub const ROTORTAIL_FIRE_RANGE: f64 = 6.5;

pub const STILTNECK_BOMB_SPEED: f64 = 4.2;
pub const STILTNECK_BOMB_FUSE: f64 = 1.8;
pub const STILTNECK_BLAST_RADIUS: f64 = 2.2;
pub const STILTNECK_BLAST_DAMAGE: i32 = 28;
pub const STILTNECK_BLAST_ENEMY_DAMAGE: i32 = 20;
pub const STILTNECK_BLAST_PUSH: f64 = 8.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectileKind {
    Bullet,
    Arrow,
    Flame,
    Pellet,
    Laser,
    Missile,
    SpitterGlob,
    WebGlob,
    GolemShard,
    JesterDisc,
    CroakerBeam,
    RotortailTimber,
    StiltneckBomb,
}

#[derive(Debug, Clone)]
pub struct Projectile {
    pub id: u64,
    pub kind: ProjectileKind,
    pub x: f64,
    pub z: f64,
    pub vx: f64,
    pub vz: f64,
    pub life: f64,
    pub max_life: f64,
    pub damage: i32,
    pub is_player: bool,
    pub pierce: i32,
    pub curve_rate: f64,
    pub dead: bool,
    pub radius: f64,
}

impl Projectile {
    pub fn new_player_shot(
        id: u64,
        kind: ProjectileKind,
        x: f64,
        z: f64,
        dir_x: f64,
        dir_z: f64,
        speed: f64,
        damage: i32,
        life: f64,
    ) -> Self {
        let len = (dir_x * dir_x + dir_z * dir_z).sqrt().max(1e-6);
        let nx = dir_x / len;
        let nz = dir_z / len;
        Self {
            id,
            kind,
            x: x + nx * MUZZLE_OFFSET,
            z: z + nz * MUZZLE_OFFSET,
            vx: nx * speed,
            vz: nz * speed,
            life,
            max_life: life,
            damage,
            is_player: true,
            pierce: if kind == ProjectileKind::Flame || kind == ProjectileKind::Laser { 99 } else { 0 },
            curve_rate: 0.0,
            dead: false,
            radius: if kind == ProjectileKind::Flame { 0.28 } else { HIT_R },
        }
    }

    pub fn new_enemy_shot(
        id: u64,
        kind: ProjectileKind,
        x: f64,
        z: f64,
        dir_x: f64,
        dir_z: f64,
        speed: f64,
        damage: i32,
        life: f64,
    ) -> Self {
        let len = (dir_x * dir_x + dir_z * dir_z).sqrt().max(1e-6);
        let nx = dir_x / len;
        let nz = dir_z / len;
        Self {
            id,
            kind,
            x: x + nx * 0.25,
            z: z + nz * 0.25,
            vx: nx * speed,
            vz: nz * speed,
            life,
            max_life: life,
            damage,
            is_player: false,
            pierce: 0,
            curve_rate: 0.0,
            dead: false,
            radius: HIT_R,
        }
    }
}

/// Advance a projectile collection by `dt` against world grid bounds.
pub fn step_projectiles(projectiles: &mut Vec<Projectile>, grid: &Grid, dt: f64) {
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
        if !is_walkable(grid, ti, tj) {
            p.dead = true;
        }
    }

    projectiles.retain(|p| !p.dead);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grid::{set_tile, Grid, T_FLOOR};

    #[test]
    fn player_shot_travels_and_expires() {
        let mut projs = vec![Projectile::new_player_shot(
            1,
            ProjectileKind::Bullet,
            5.0,
            5.0,
            1.0,
            0.0,
            10.0,
            25,
            0.5,
        )];
        let mut grid = Grid::solid(20, 20);
        for i in 1..19 {
            for j in 1..19 {
                set_tile(&mut grid, i, j, T_FLOOR);
            }
        }

        step_projectiles(&mut projs, &grid, 0.1);
        assert_eq!(projs.len(), 1);
        assert!(projs[0].x > 5.0);

        // Step past life
        step_projectiles(&mut projs, &grid, 0.5);
        assert_eq!(projs.len(), 0);
    }

    #[test]
    fn projectile_dies_against_wall() {
        let mut projs = vec![Projectile::new_player_shot(
            2,
            ProjectileKind::Arrow,
            1.5,
            1.5,
            -1.0,
            0.0,
            10.0,
            30,
            2.0,
        )];
        let grid = Grid::solid(10, 10);

        step_projectiles(&mut projs, &grid, 0.2);
        assert_eq!(projs.len(), 0);
    }
}
