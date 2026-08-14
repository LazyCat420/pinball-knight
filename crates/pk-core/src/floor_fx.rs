//! Floor FX — persistent scars a marble material leaves on the ground.
//!
//! Port of `legacy/src/game/pinball-knight/entities/floor-fx.ts` (993 lines).
//!
//! Ground decals that outlive the bounce/slam and tick status/damage to foes:
//!   - slick (Water): enemies lose footing, slip and skid
//!   - fire (Lava): burning puddle ticking burn damage
//!   - shard_field (Diamond): ground glitter field
//!   - oil: foes lose steering, ball gains glide, ignites on fire
//!   - groove: physical slot carved into stone acting as a rail guide
//!   - frost: chill slow field
//!   - tar: heavy drag field
//!   - rod: lightning arc emitter
//!   - molten: superheated melted stone
//!
//! PORTS: `entities/floor-fx.ts`

use crate::zombie_ai::{EnemyMode, LiveEnemy};

pub const FLOOR_FX_MAX: usize = 64;
pub const FLOORFX_TICK: f64 = 0.20;
pub const WATER_SLIP_TIME: f64 = 1.2;
pub const WATER_SLIP_SPEED: f64 = 5.5;
pub const FIRE_PUDDLE_DMG: i32 = 8;
pub const OIL_ZOMBIE_T: f64 = 2.0;
pub const OIL_MARBLE_T: f64 = 1.5;
pub const OIL_IGNITE_LIFE: f64 = 4.0;
pub const GROOVE_RADIUS: f64 = 0.45;
pub const GROOVE_LIFE: f64 = 8.0;
pub const MELT_RADIUS: f64 = 0.55;
pub const MELT_LIFE: f64 = 6.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FloorFxKind {
    Slick,
    Fire,
    ShardField,
    Oil,
    Groove,
    Frost,
    Tar,
    Rod,
    Molten,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FloorFx {
    pub id: u64,
    pub kind: FloorFxKind,
    pub x: f64,
    pub z: f64,
    pub radius: f64,
    pub life: f64,
    pub max_life: f64,
    pub hostile: bool,
    pub tick_t: f64,
    pub dir_x: f64,
    pub dir_z: f64,
    pub speed: f64,
}

impl FloorFx {
    pub fn new(
        id: u64,
        kind: FloorFxKind,
        x: f64,
        z: f64,
        radius: f64,
        life: f64,
        hostile: bool,
    ) -> Self {
        Self {
            id,
            kind,
            x,
            z,
            radius,
            life,
            max_life: life,
            hostile,
            tick_t: FLOORFX_TICK,
            dir_x: 0.0,
            dir_z: 0.0,
            speed: 0.0,
        }
    }
}

/// Spawns a new floor effect, enforcing the pool cap by ejecting oldest.
pub fn spawn_floor_fx(
    pool: &mut Vec<FloorFx>,
    id: u64,
    kind: FloorFxKind,
    x: f64,
    z: f64,
    radius: f64,
    life: f64,
    hostile: bool,
) {
    if pool.len() >= FLOOR_FX_MAX {
        pool.remove(0);
    }
    pool.push(FloorFx::new(id, kind, x, z, radius, life, hostile));
}

/// Carves a groove along a ball's high-speed trajectory.
pub fn carve_groove(pool: &mut Vec<FloorFx>, id: u64, x: f64, z: f64, speed: f64, dir_x: f64, dir_z: f64) {
    if speed < 4.0 {
        return;
    }
    let mut fx = FloorFx::new(id, FloorFxKind::Groove, x, z, GROOVE_RADIUS, GROOVE_LIFE, false);
    fx.speed = speed;
    let len = (dir_x * dir_x + dir_z * dir_z).sqrt().max(1e-6);
    fx.dir_x = dir_x / len;
    fx.dir_z = dir_z / len;
    if pool.len() >= FLOOR_FX_MAX {
        pool.remove(0);
    }
    pool.push(fx);
}

/// Melts a superheated molten scar into the floor.
pub fn melt_floor(pool: &mut Vec<FloorFx>, id: u64, x: f64, z: f64, speed: f64, dir_x: f64, dir_z: f64) {
    if speed < 4.0 {
        return;
    }
    let mut fx = FloorFx::new(id, FloorFxKind::Molten, x, z, MELT_RADIUS, MELT_LIFE, false);
    fx.speed = speed;
    let len = (dir_x * dir_x + dir_z * dir_z).sqrt().max(1e-6);
    fx.dir_x = dir_x / len;
    fx.dir_z = dir_z / len;
    if pool.len() >= FLOOR_FX_MAX {
        pool.remove(0);
    }
    pool.push(fx);
}

/// Ticks all active floor effects and applies surface interactions.
pub fn update_floor_fx(
    pool: &mut Vec<FloorFx>,
    enemies: &mut [LiveEnemy],
    player_pos: (f64, f64),
    player_oil_t: &mut f64,
    dt: f64,
) {
    // 1. Tick life and tick timer
    for fx in pool.iter_mut() {
        fx.life -= dt;
        fx.tick_t -= dt;
    }

    // 2. Oil ignition check (fire overlapping oil converts oil to fire)
    let len = pool.len();
    for i in 0..len {
        if pool[i].kind != FloorFxKind::Fire || pool[i].life <= 0.0 {
            continue;
        }
        let (fx_x, fx_z, fx_r) = (pool[i].x, pool[i].z, pool[i].radius);
        for j in 0..len {
            if pool[j].kind == FloorFxKind::Oil && pool[j].life > 0.0 {
                let dx = pool[j].x - fx_x;
                let dz = pool[j].z - fx_z;
                if (dx * dx + dz * dz).sqrt() <= fx_r + pool[j].radius {
                    pool[j].kind = FloorFxKind::Fire;
                    pool[j].life = OIL_IGNITE_LIFE;
                    pool[j].max_life = OIL_IGNITE_LIFE;
                }
            }
        }
    }

    // 3. Apply floor effects to enemies
    for fx in pool.iter() {
        if fx.life <= 0.0 {
            continue;
        }
        let should_tick = fx.tick_t <= 0.0;

        for enemy in enemies.iter_mut() {
            if enemy.mode == EnemyMode::Dead {
                continue;
            }
            let dx = enemy.x - fx.x;
            let dz = enemy.z - fx.z;
            let dist = (dx * dx + dz * dz).sqrt();
            if dist <= fx.radius + enemy.radius {
                match fx.kind {
                    FloorFxKind::Fire | FloorFxKind::Molten => {
                        if should_tick {
                            enemy.hp = (enemy.hp - f64::from(FIRE_PUDDLE_DMG)).max(0.0);
                            if enemy.hp <= 0.0 {
                                enemy.mode = EnemyMode::Dead;
                            }
                        }
                    }
                    FloorFxKind::Slick => {
                        // Trip/slide enemy
                        enemy.vx += fx.dir_x * WATER_SLIP_SPEED * dt;
                        enemy.vz += fx.dir_z * WATER_SLIP_SPEED * dt;
                    }
                    FloorFxKind::Frost | FloorFxKind::Tar => {
                        // Heavy slow
                        enemy.vx *= 0.65;
                        enemy.vz *= 0.65;
                    }
                    _ => {}
                }
            }
        }

        // Apply oil glide to player
        let pdx = player_pos.0 - fx.x;
        let pdz = player_pos.1 - fx.z;
        if fx.kind == FloorFxKind::Oil && (pdx * pdx + pdz * pdz).sqrt() <= fx.radius + 0.3 {
            *player_oil_t = OIL_MARBLE_T;
        }
    }

    // Reset periodic tick timers
    for fx in pool.iter_mut() {
        if fx.tick_t <= 0.0 {
            fx.tick_t = FLOORFX_TICK;
        }
    }

    // Retain living effects
    pool.retain(|fx| fx.life > 0.0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn floor_fx_lifecycle_and_oil_ignition() {
        let mut pool = Vec::new();
        spawn_floor_fx(&mut pool, 1, FloorFxKind::Oil, 5.0, 5.0, 1.0, 5.0, false);
        assert_eq!(pool.len(), 1);

        let mut enemies = Vec::new();
        let mut player_oil_t = 0.0;
        update_floor_fx(&mut pool, &mut enemies, (5.0, 5.0), &mut player_oil_t, 0.1);
        assert!(player_oil_t > 0.0, "standing on oil gives oil glide timer");

        // Spawn fire overlapping oil
        spawn_floor_fx(&mut pool, 2, FloorFxKind::Fire, 5.2, 5.0, 1.0, 4.0, false);
        assert_eq!(pool.len(), 2);

        update_floor_fx(&mut pool, &mut enemies, (0.0, 0.0), &mut player_oil_t, 0.1);

        // Oil should now be ignited into fire
        assert_eq!(pool[0].kind, FloorFxKind::Fire);
        assert_eq!(pool[0].life, OIL_IGNITE_LIFE);
    }
}
