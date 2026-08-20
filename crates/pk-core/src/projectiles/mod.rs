//! Projectile simulation, trajectory math, and collision hitboxes.
//!
//! PORTS: `entities/projectiles.ts`

pub mod collision;
pub mod simulate;
pub mod types;

pub use collision::{check_enemy_projectile_hits, check_player_projectile_hits, ProjectileHit};
pub use simulate::step_projectiles_sim;
pub use types::*;

use std::sync::Mutex;

static PROJECTILE_POOL: Mutex<Vec<Projectile>> = Mutex::new(Vec::new());

pub fn dispose_projectile_assets() {
    clear_projectiles();
}

pub fn clear_projectiles() {
    if let Ok(mut lock) = PROJECTILE_POOL.lock() {
        lock.clear();
    }
}

pub fn spawn_shard_burst(x: f64, z: f64, count: usize, speed: f64, damage: i32) {
    if let Ok(mut lock) = PROJECTILE_POOL.lock() {
        for i in 0..count {
            let angle = (i as f64 / count as f64) * std::f64::consts::TAU;
            let vx = angle.cos() * speed;
            let vz = angle.sin() * speed;
            lock.push(Projectile::new(
                x,
                z,
                vx,
                vz,
                damage,
                GOLEM_SHARD_LIFE,
                false,
                ProjectileKind::GolemShard,
            ));
        }
    }
}

pub fn spit_glob(x: f64, z: f64, dx: f64, dz: f64) {
    if let Ok(mut lock) = PROJECTILE_POOL.lock() {
        let len = (dx * dx + dz * dz).sqrt().max(1e-4);
        let vx = (dx / len) * SPITTER_GLOB_SPEED;
        let vz = (dz / len) * SPITTER_GLOB_SPEED;
        lock.push(Projectile::new(
            x,
            z,
            vx,
            vz,
            SPITTER_DAMAGE,
            2.0,
            false,
            ProjectileKind::SpitterGlob,
        ));
    }
}

pub fn spit_web(x: f64, z: f64, dx: f64, dz: f64) {
    if let Ok(mut lock) = PROJECTILE_POOL.lock() {
        let len = (dx * dx + dz * dz).sqrt().max(1e-4);
        let vx = (dx / len) * WEB_GLOB_SPEED;
        let vz = (dz / len) * WEB_GLOB_SPEED;
        lock.push(Projectile::new(
            x,
            z,
            vx,
            vz,
            10,
            2.5,
            false,
            ProjectileKind::WebGlob,
        ));
    }
}

pub fn fling_plate(x: f64, z: f64, dx: f64, dz: f64) {
    if let Ok(mut lock) = PROJECTILE_POOL.lock() {
        let len = (dx * dx + dz * dz).sqrt().max(1e-4);
        let vx = (dx / len) * JESTER_DISC_SPEED;
        let vz = (dz / len) * JESTER_DISC_SPEED;
        lock.push(Projectile::new(
            x,
            z,
            vx,
            vz,
            JESTER_DISC_DAMAGE,
            JESTER_DISC_LIFE,
            false,
            ProjectileKind::JesterDisc,
        ));
    }
}

pub fn hurl_timber(x: f64, z: f64, dx: f64, dz: f64) {
    if let Ok(mut lock) = PROJECTILE_POOL.lock() {
        let len = (dx * dx + dz * dz).sqrt().max(1e-4);
        let vx = (dx / len) * ROTORTAIL_TIMBER_SPEED;
        let vz = (dz / len) * ROTORTAIL_TIMBER_SPEED;
        lock.push(Projectile::new(
            x,
            z,
            vx,
            vz,
            ROTORTAIL_TIMBER_DAMAGE,
            3.0,
            false,
            ProjectileKind::RotortailTimber,
        ));
    }
}

pub fn sling_bomb(x: f64, z: f64, dx: f64, dz: f64) {
    if let Ok(mut lock) = PROJECTILE_POOL.lock() {
        let len = (dx * dx + dz * dz).sqrt().max(1e-4);
        let vx = (dx / len) * STILTNECK_BOMB_SPEED;
        let vz = (dz / len) * STILTNECK_BOMB_SPEED;
        lock.push(Projectile::new(
            x,
            z,
            vx,
            vz,
            STILTNECK_BLAST_DAMAGE,
            STILTNECK_BOMB_FUSE,
            false,
            ProjectileKind::StiltneckBomb,
        ));
    }
}

pub fn detonate(x: f64, z: f64) {
    spawn_shard_burst(x, z, 8, 6.0, 30);
}

pub fn fire_eye_beams(x: f64, z: f64, dx: f64, dz: f64) {
    if let Ok(mut lock) = PROJECTILE_POOL.lock() {
        let len = (dx * dx + dz * dz).sqrt().max(1e-4);
        let vx = (dx / len) * CROAKER_BEAM_SPEED;
        let vz = (dz / len) * CROAKER_BEAM_SPEED;
        lock.push(Projectile::new(
            x,
            z,
            vx,
            vz,
            CROAKER_BEAM_DAMAGE,
            1.5,
            false,
            ProjectileKind::CroakerBeam,
        ));
    }
}

pub fn golem_shards(x: f64, z: f64) {
    spawn_shard_burst(x, z, GOLEM_SHARDS, GOLEM_SHARD_SPEED, GOLEM_SHARD_DAMAGE);
}

pub fn fire_weapon(_w: &str, px: f64, pz: f64, fx: f64, fz: f64) {
    if let Ok(mut lock) = PROJECTILE_POOL.lock() {
        let len = (fx * fx + fz * fz).sqrt().max(1e-4);
        let speed = 15.0;
        let vx = (fx / len) * speed;
        let vz = (fz / len) * speed;
        lock.push(Projectile::new(
            px,
            pz,
            vx,
            vz,
            25,
            1.0,
            true,
            ProjectileKind::Bullet,
        ));
    }
}

pub fn update_projectiles(dt: f64) {
    if let Ok(mut lock) = PROJECTILE_POOL.lock() {
        for p in lock.iter_mut() {
            p.step(dt);
        }
        lock.retain(|p| !p.dead);
    }
}
