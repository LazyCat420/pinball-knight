//! Monster bestiary AI, abilities, and horde simulation.
//!
//! PORTS: `entities/enemy-rules.ts`
//! PORTS-PARTIAL: `entities/zombie.ts` - NOT a finished port - 0 of 5 exported names carried over (0%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md
//! PORTS-PARTIAL: `bestiary.ts` - NOT a finished port - 0 of 6 exported names carried over (0%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

pub mod boss_king;
pub mod croaker;
pub mod ghost;
pub mod golem;
pub mod jester;
pub mod separation;
pub mod stiltneck;
pub mod types;

pub use boss_king::{step_boss_king, BossKingAction, BossKingState, KingPhase};
pub use croaker::{step_croaker_hop, CROAKER_ACID_DAMAGE, CROAKER_ACID_RADIUS};
pub use ghost::{ghost_hover_offset, step_ghost};
pub use golem::{generate_golem_shards, ShardBurst};
pub use jester::JesterDisc;
pub use separation::apply_monster_separation;
pub use stiltneck::{resolve_bomb_blast, step_stiltneck_bombs, BlastResult, StiltneckBomb};
pub use types::{EnemyKind, EnemyMode, LiveMonster, MonsterDef};

use crate::collide::move_circle;
use crate::flow_field::flow_step;
use crate::grid::{tile_center, world_to_tile, Grid};

pub const DIRECT_STEER_RANGE: f64 = 1.6;

/// High-level 60 Hz stepping function for the entire active monster horde.
pub fn update_monsters_horde(
    monsters: &mut [LiveMonster],
    grid: &Grid,
    player_x: f64,
    player_z: f64,
    flow_distances: &[i32],
    dt: f64,
) {
    for m in monsters.iter_mut() {
        if !m.is_alive() {
            continue;
        }

        // 1. Tick timers
        if m.attack_cd > 0.0 {
            m.attack_cd = (m.attack_cd - dt).max(0.0);
        }
        if m.stagger_t > 0.0 {
            m.stagger_t = (m.stagger_t - dt).max(0.0);
            if m.stagger_t == 0.0 && m.mode == EnemyMode::Stagger {
                m.mode = EnemyMode::Chase;
            }
            continue; // Stagger freezes motion
        }

        // 2. Kind-specific movement and ability branches
        match m.kind {
            EnemyKind::Croaker => {
                step_croaker_hop(m, grid, player_x, player_z, dt);
                if m.mode == EnemyMode::Hop {
                    continue;
                }
            }
            EnemyKind::Ghost => {
                step_ghost(m, grid, player_x, player_z, dt);
                continue;
            }
            _ => {}
        }

        let dx = player_x - m.x;
        let dz = player_z - m.z;
        let dist = (dx * dx + dz * dz).sqrt();

        // 3. Attack State Machine
        match m.mode {
            EnemyMode::Windup => {
                m.windup_t -= dt;
                if m.windup_t <= 0.0 {
                    m.mode = EnemyMode::Attack;
                }
            }
            EnemyMode::Attack => {
                m.attack_cd = m.cooldown_duration;
                m.mode = EnemyMode::Chase;
            }
            EnemyMode::Chase | EnemyMode::Wander => {
                if dist <= m.contact_range && m.attack_cd <= 0.0 {
                    m.mode = EnemyMode::Windup;
                    m.windup_t = m.windup_duration;
                    continue;
                }

                // 4. Flow-field & Direct Steering
                let (dir_x, dir_z) = if dist < DIRECT_STEER_RANGE {
                    if dist > 1e-4 {
                        (dx / dist, dz / dist)
                    } else {
                        (0.0, 0.0)
                    }
                } else {
                    let (ti, tj) = world_to_tile(grid, m.x, m.z);
                    if let Some((next_i, next_j)) = flow_step(grid, flow_distances, ti, tj) {
                        let (tc_x, tc_z) = tile_center(grid, next_i, next_j);
                        let tdx = tc_x - m.x;
                        let tdz = tc_z - m.z;
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

                let target_vx = dir_x * m.speed;
                let target_vz = dir_z * m.speed;

                let blend = (8.0 * dt).min(1.0);
                m.vx += (target_vx - m.vx) * blend;
                m.vz += (target_vz - m.vz) * blend;

                let res = move_circle(grid, m.x, m.z, m.radius, m.vx * dt, m.vz * dt);
                m.x = res.x;
                m.z = res.z;
            }
            _ => {}
        }
    }

    // 5. Horde separation
    apply_monster_separation(monsters, dt);
}
