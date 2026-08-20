//! Floor FX — persistent ground scars and material hazard discs.
//!
//! PORTS: `entities/floor-fx.ts`

use crate::monsters::types::{EnemyMode, LiveMonster};

pub const FLOOR_FX_MAX: usize = 64;
pub const WATER_SLIP_TIME: f64 = 1.2;
pub const WATER_SLIP_SPEED: f64 = 6.0;
pub const FIRE_PUDDLE_DMG: f64 = 1.0;
pub const CARD_BURN_TICK: f64 = 0.5;
pub const OIL_IGNITE_LIFE: f64 = 6.0;
pub const TAR_DRAG: f64 = 0.4;

pub const GROOVE_MIN_SPEED: f64 = 4.0;
pub const GROOVE_SPACING: f64 = 0.28;
pub const GROOVE_RADIUS: f64 = 0.42;
pub const GROOVE_LIFE: f64 = 14.0;
pub const GROOVE_TRIP_TIME: f64 = 0.45;
pub const GROOVE_TRIP_SPEED: f64 = 2.4;

pub const MELT_MIN_SPEED: f64 = 2.0;
pub const MELT_SPACING: f64 = 0.32;
pub const MELT_RADIUS: f64 = 0.48;
pub const MELT_LIFE: f64 = 8.0;

pub const PINBALL_MAX_SPEED: f64 = 24.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FloorFxKind {
    Slick,
    Fire,
    Oil,
    ShardField,
    Groove,
    Molten,
    Tar,
}

pub fn floor_fx_kinds() -> &'static [FloorFxKind] {
    &[
        FloorFxKind::Slick,
        FloorFxKind::Fire,
        FloorFxKind::Oil,
        FloorFxKind::ShardField,
        FloorFxKind::Groove,
        FloorFxKind::Molten,
        FloorFxKind::Tar,
    ]
}

#[derive(Debug, Clone, PartialEq)]
pub struct FloorFx {
    pub id: u32,
    pub kind: FloorFxKind,
    pub x: f64,
    pub z: f64,
    pub radius: f64,
    pub life: f64,
    pub max_life: f64,
    pub tick_t: f64,
    pub dir_x: f64,
    pub dir_z: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FloorFxImpact {
    pub fx_id: u32,
    pub monster_id: u32,
    pub damage: f64,
    pub applied_slip: bool,
}

/// Spawns a new floor FX ground disc, respecting active capacity.
pub fn spawn_floor_fx(
    fx_list: &mut Vec<FloorFx>,
    next_id: &mut u32,
    kind: FloorFxKind,
    x: f64,
    z: f64,
    radius: f64,
    life: f64,
) {
    if fx_list.len() >= FLOOR_FX_MAX {
        fx_list.remove(0);
    }

    *next_id += 1;
    fx_list.push(FloorFx {
        id: *next_id,
        kind,
        x,
        z,
        radius,
        life,
        max_life: life,
        tick_t: 0.0,
        dir_x: 0.0,
        dir_z: 0.0,
    });
}

pub fn warm_floor_fx_reveal() {}

pub fn dispose_floor_fx_assets() {}

pub fn carve_groove(
    fx_list: &mut Vec<FloorFx>,
    next_id: &mut u32,
    x: f64,
    z: f64,
    speed: f64,
    dir_x: f64,
    dir_z: f64,
) {
    if speed < GROOVE_MIN_SPEED {
        return;
    }
    let bite = (speed / PINBALL_MAX_SPEED).clamp(0.0, 1.0);
    let r = GROOVE_RADIUS * (0.8 + bite * 0.5);
    spawn_floor_fx(fx_list, next_id, FloorFxKind::Groove, x, z, r, GROOVE_LIFE);
    if let Some(cut) = fx_list.last_mut() {
        let len = (dir_x * dir_x + dir_z * dir_z).sqrt();
        cut.dir_x = if len > 1e-6 { dir_x / len } else { 1.0 };
        cut.dir_z = if len > 1e-6 { dir_z / len } else { 0.0 };
    }
}

pub fn melt_floor(
    fx_list: &mut Vec<FloorFx>,
    next_id: &mut u32,
    x: f64,
    z: f64,
    speed: f64,
    dir_x: f64,
    dir_z: f64,
) {
    if speed < MELT_MIN_SPEED {
        return;
    }
    let bite = (speed / PINBALL_MAX_SPEED).clamp(0.0, 1.0);
    let r = MELT_RADIUS * (0.78 + bite * 0.44);
    spawn_floor_fx(fx_list, next_id, FloorFxKind::Molten, x, z, r, MELT_LIFE);
    if let Some(scar) = fx_list.last_mut() {
        let len = (dir_x * dir_x + dir_z * dir_z).sqrt();
        scar.dir_x = if len > 1e-6 { dir_x / len } else { 1.0 };
        scar.dir_z = if len > 1e-6 { dir_z / len } else { 0.0 };
    }
}

pub fn groove_interact(
    fx: &FloorFx,
    monsters: &mut [LiveMonster],
    ticked: bool,
) -> Vec<FloorFxImpact> {
    let mut impacts = Vec::new();
    let r_sum = fx.radius + 0.4;
    for m in monsters.iter_mut() {
        if m.mode == EnemyMode::Dead {
            continue;
        }
        let dx = m.x - fx.x;
        let dz = m.z - fx.z;
        if dx * dx + dz * dz > r_sum * r_sum {
            continue;
        }
        let d = (dx * dx + dz * dz).sqrt().max(0.001);
        m.vx = (dx / d) * GROOVE_TRIP_SPEED;
        m.vz = (dz / d) * GROOVE_TRIP_SPEED;
        if ticked {
            impacts.push(FloorFxImpact {
                fx_id: fx.id,
                monster_id: m.id,
                damage: 0.0,
                applied_slip: true,
            });
        }
    }
    impacts
}

pub fn update_groove_hop(_dt: f64) {}

pub fn clear_floor_fx(fx_list: &mut Vec<FloorFx>) {
    fx_list.clear();
}

pub fn update_floor_fx(_dt: f64) {}

/// Advances active floor FX discs, processes chemical reactions (e.g. oil ignition), and applies monster effects.
pub fn step_floor_fx(
    fx_list: &mut Vec<FloorFx>,
    monsters: &mut [LiveMonster],
    dt: f64,
) -> Vec<FloorFxImpact> {
    // 1. Process chemical chain reactions (Fire ignites Oil)
    let fire_positions: Vec<(f64, f64, f64)> = fx_list
        .iter()
        .filter(|fx| fx.kind == FloorFxKind::Fire)
        .map(|fx| (fx.x, fx.z, fx.radius))
        .collect();

    for fx in fx_list.iter_mut() {
        if fx.kind == FloorFxKind::Oil {
            for &(fx_x, fx_z, fx_r) in &fire_positions {
                let dx = fx.x - fx_x;
                let dz = fx.z - fx_z;
                if dx * dx + dz * dz <= (fx.radius + fx_r).powi(2) {
                    fx.kind = FloorFxKind::Fire;
                    fx.life = OIL_IGNITE_LIFE;
                    fx.max_life = OIL_IGNITE_LIFE;
                    break;
                }
            }
        }
    }

    let mut impacts = Vec::new();

    // 2. Step timers and apply area effects
    for fx in fx_list.iter_mut() {
        fx.life -= dt;
        fx.tick_t += dt;

        for m in monsters.iter_mut() {
            if m.mode == EnemyMode::Dead {
                continue;
            }

            let dx = m.x - fx.x;
            let dz = m.z - fx.z;
            let dist_sq = dx * dx + dz * dz;

            if dist_sq <= fx.radius.powi(2) {
                match fx.kind {
                    FloorFxKind::Slick => {
                        let dist = dist_sq.sqrt();
                        let push_dx = if dist > 0.001 { dx / dist } else { 1.0 };
                        let push_dz = if dist > 0.001 { dz / dist } else { 0.0 };
                        m.vx = push_dx * WATER_SLIP_SPEED;
                        m.vz = push_dz * WATER_SLIP_SPEED;
                        impacts.push(FloorFxImpact {
                            fx_id: fx.id,
                            monster_id: m.id,
                            damage: 0.0,
                            applied_slip: true,
                        });
                    }
                    FloorFxKind::Fire => {
                        if fx.tick_t >= CARD_BURN_TICK {
                            m.hp -= FIRE_PUDDLE_DMG;
                            if m.hp <= 0.0 {
                                m.mode = EnemyMode::Dead;
                            }
                            impacts.push(FloorFxImpact {
                                fx_id: fx.id,
                                monster_id: m.id,
                                damage: FIRE_PUDDLE_DMG,
                                applied_slip: false,
                            });
                        }
                    }
                    FloorFxKind::Tar => {
                        m.vx *= 1.0 - TAR_DRAG;
                        m.vz *= 1.0 - TAR_DRAG;
                    }
                    FloorFxKind::Groove => {
                        let sub_impacts = groove_interact(fx, std::slice::from_mut(m), fx.tick_t >= CARD_BURN_TICK);
                        impacts.extend(sub_impacts);
                    }
                    _ => {}
                }
            }
        }

        if fx.tick_t >= CARD_BURN_TICK {
            fx.tick_t = 0.0;
        }
    }

    // 3. Remove expired discs
    fx_list.retain(|fx| fx.life > 0.0);

    impacts
}
