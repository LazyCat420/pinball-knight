//! Floor FX — persistent ground scars and material hazard discs.
//!
//! PORTS-PARTIAL: `entities/floor-fx.ts` - NOT a finished port - 3 of 9 exported names carried over (33%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

use crate::monsters::types::{EnemyMode, LiveMonster};

pub const FLOOR_FX_MAX: usize = 64;
pub const WATER_SLIP_TIME: f64 = 1.2;
pub const WATER_SLIP_SPEED: f64 = 6.0;
pub const FIRE_PUDDLE_DMG: f64 = 1.0;
pub const CARD_BURN_TICK: f64 = 0.5;
pub const OIL_IGNITE_LIFE: f64 = 6.0;
pub const TAR_DRAG: f64 = 0.4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FloorFxKind {
    Slick,
    Fire,
    Oil,
    ShardField,
    Groove,
    Tar,
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
    });
}

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
            for &(fire_x, fire_z, fire_r) in &fire_positions {
                let dx = fx.x - fire_x;
                let dz = fx.z - fire_z;
                if (dx * dx + dz * dz).sqrt() <= fx.radius + fire_r {
                    fx.kind = FloorFxKind::Fire;
                    fx.life = OIL_IGNITE_LIFE;
                    fx.max_life = OIL_IGNITE_LIFE;
                    break;
                }
            }
        }
    }

    // 2. Advance lifetimes and monster overlaps
    let mut impacts = Vec::new();

    for fx in fx_list.iter_mut() {
        fx.life -= dt;
        fx.tick_t += dt;

        for m in monsters.iter_mut() {
            if !m.is_alive() {
                continue;
            }

            let dx = m.x - fx.x;
            let dz = m.z - fx.z;
            let dist = (dx * dx + dz * dz).sqrt();

            if dist <= fx.radius + m.radius {
                match fx.kind {
                    FloorFxKind::Slick => {
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
