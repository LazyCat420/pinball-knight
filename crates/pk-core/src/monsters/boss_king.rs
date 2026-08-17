//! Boss King Zombie state machine and royal flipper charge mechanics.
//!
//! PORTS-PARTIAL: `boss.ts` - NOT a finished port - 3 of 13 exported names carried over (23%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

use super::types::{EnemyKind, LiveMonster};
use crate::collide::move_circle;
use crate::grid::Grid;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KingPhase {
    Phase1March,
    Phase2FlipperCharge,
    Phase3EnragedRicochet,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BossKingState {
    pub phase: KingPhase,
    pub charge_t: f64,
    pub charge_dir_x: f64,
    pub charge_dir_z: f64,
    pub summon_cd: f64,
    pub enraged: bool,
}

impl Default for BossKingState {
    fn default() -> Self {
        Self {
            phase: KingPhase::Phase1March,
            charge_t: 0.0,
            charge_dir_x: 0.0,
            charge_dir_z: 0.0,
            summon_cd: 8.0,
            enraged: false,
        }
    }
}

pub enum BossKingAction {
    None,
    SpawnMinions(Vec<(EnemyKind, f64, f64)>),
    FlipperChargeImpact {
        damage: i32,
        push_x: f64,
        push_z: f64,
    },
}

/// Advances Boss King Zombie combat logic across its 3 phases.
pub fn step_boss_king(
    boss: &mut LiveMonster,
    state: &mut BossKingState,
    grid: &Grid,
    player_x: f64,
    player_z: f64,
    dt: f64,
) -> BossKingAction {
    if !boss.is_alive() {
        return BossKingAction::None;
    }

    let hp_ratio = boss.hp / boss.max_hp;
    if hp_ratio <= 0.33 {
        state.phase = KingPhase::Phase3EnragedRicochet;
        state.enraged = true;
    } else if hp_ratio <= 0.66 {
        state.phase = KingPhase::Phase2FlipperCharge;
    }

    state.summon_cd = (state.summon_cd - dt).max(0.0);

    let dx = player_x - boss.x;
    let dz = player_z - boss.z;
    let dist = (dx * dx + dz * dz).sqrt();

    // Periodic Minion Summoning
    if state.summon_cd <= 0.0 {
        state.summon_cd = 12.0;
        let minions = vec![
            (EnemyKind::Zombie, boss.x + 1.2, boss.z),
            (EnemyKind::Zombie, boss.x - 1.2, boss.z),
            (EnemyKind::Goblin, boss.x, boss.z + 1.2),
            (EnemyKind::Goblin, boss.x, boss.z - 1.2),
        ];
        return BossKingAction::SpawnMinions(minions);
    }

    match state.phase {
        KingPhase::Phase1March => {
            if dist > 1e-4 {
                boss.vx = (dx / dist) * boss.speed;
                boss.vz = (dz / dist) * boss.speed;
            }
            let res = move_circle(
                grid,
                boss.x,
                boss.z,
                boss.radius,
                boss.vx * dt,
                boss.vz * dt,
            );
            boss.x = res.x;
            boss.z = res.z;
        }
        KingPhase::Phase2FlipperCharge => {
            if state.charge_t > 0.0 {
                state.charge_t -= dt;
                let res = move_circle(
                    grid,
                    boss.x,
                    boss.z,
                    boss.radius,
                    boss.vx * dt,
                    boss.vz * dt,
                );
                boss.x = res.x;
                boss.z = res.z;

                if dist < boss.radius + 0.4 {
                    state.charge_t = 0.0;
                    return BossKingAction::FlipperChargeImpact {
                        damage: 28,
                        push_x: state.charge_dir_x * 12.0,
                        push_z: state.charge_dir_z * 12.0,
                    };
                }
            } else {
                // Wind up next flipper charge
                if dist > 1.5 && dist < 8.0 && boss.attack_cd <= 0.0 {
                    state.charge_t = 0.8;
                    boss.attack_cd = 3.5;
                    let nx = dx / dist;
                    let nz = dz / dist;
                    state.charge_dir_x = nx;
                    state.charge_dir_z = nz;
                    boss.vx = nx * 10.5;
                    boss.vz = nz * 10.5;
                } else {
                    if dist > 1e-4 {
                        boss.vx = (dx / dist) * boss.speed;
                        boss.vz = (dz / dist) * boss.speed;
                    }
                    let res = move_circle(
                        grid,
                        boss.x,
                        boss.z,
                        boss.radius,
                        boss.vx * dt,
                        boss.vz * dt,
                    );
                    boss.x = res.x;
                    boss.z = res.z;
                }
            }
        }
        KingPhase::Phase3EnragedRicochet => {
            // Speed increased in enraged phase
            let enraged_speed = boss.speed * 1.5;
            if dist > 1e-4 {
                boss.vx = (dx / dist) * enraged_speed;
                boss.vz = (dz / dist) * enraged_speed;
            }
            let res = move_circle(
                grid,
                boss.x,
                boss.z,
                boss.radius,
                boss.vx * dt,
                boss.vz * dt,
            );
            boss.x = res.x;
            boss.z = res.z;
        }
    }

    BossKingAction::None
}
