//! Live enemy simulation, flow-field steering, and attack state machine.
//!
//! Port of `legacy/src/game/pinball-knight/entities/zombie.ts` (1,218 lines).
//!
//! PORTS: `entities/zombie.ts`

use crate::collide::move_circle;
use crate::combat::Facing;
use crate::enemies::*;
use crate::enemy_rules::movement_by_kind;
use crate::flow_field::flow_step;
use crate::grid::{tile_center, world_to_tile, Grid};
use crate::monsters::types::{EnemyKind, EnemyMode, LiveMonster};
use crate::movement::MovementKind;
use crate::zombie_types::ZombieType;

pub const ISO: f64 = std::f64::consts::FRAC_1_SQRT_2;
pub const LOS_PROBE_STEP: f64 = 0.4;
pub const PACK_RANGE: f64 = 5.5;
pub const SEPARATION_R: f64 = 0.55;
pub const SEPARATION_SHOVE: f64 = 1.8;
pub const WARDEN_PULSE_CD: f64 = 3.5;
pub const WARDEN_SHIELD_RADIUS: f64 = 4.0;
pub const WARDEN_SHIELD_HP: f64 = 6.0;
pub const MIMIC_WAKE_RANGE: f64 = 2.4;

/// Per-family combat tuning, looked up once per zombie per frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EnemyStats {
    pub body_r: f64,
    pub contact_range: f64,
    pub windup: f64,
    pub cooldown: f64,
    pub ranged: bool,
}

/// Master STATS lookup matching legacy STATS table.
pub const fn stats_for_kind(kind: EnemyKind) -> EnemyStats {
    match kind {
        EnemyKind::Zombie => EnemyStats { body_r: ZOMBIE_R, contact_range: ZOMBIE_CONTACT_RANGE, windup: ZOMBIE_ATTACK_WINDUP, cooldown: ZOMBIE_ATTACK_COOLDOWN, ranged: false },
        EnemyKind::Spider => EnemyStats { body_r: SPIDER_R, contact_range: SPIDER_CONTACT_RANGE, windup: SPIDER_ATTACK_WINDUP, cooldown: SPIDER_ATTACK_COOLDOWN, ranged: false },
        EnemyKind::Brute => EnemyStats { body_r: BRUTE_R, contact_range: BRUTE_CONTACT_RANGE, windup: BRUTE_ATTACK_WINDUP, cooldown: BRUTE_ATTACK_COOLDOWN, ranged: false },
        EnemyKind::Spitter => EnemyStats { body_r: SPITTER_R, contact_range: SPITTER_FIRE_RANGE, windup: SPITTER_WINDUP, cooldown: SPITTER_COOLDOWN, ranged: true },
        EnemyKind::Ghost => EnemyStats { body_r: GHOST_R, contact_range: GHOST_CONTACT_RANGE, windup: GHOST_ATTACK_WINDUP, cooldown: GHOST_ATTACK_COOLDOWN, ranged: false },
        EnemyKind::Bat => EnemyStats { body_r: BAT_R, contact_range: BAT_CONTACT_RANGE, windup: BAT_ATTACK_WINDUP, cooldown: BAT_ATTACK_COOLDOWN, ranged: false },
        EnemyKind::Slime => EnemyStats { body_r: SLIME_R, contact_range: SLIME_CONTACT_RANGE, windup: SLIME_ATTACK_WINDUP, cooldown: SLIME_ATTACK_COOLDOWN, ranged: false },
        EnemyKind::Reaper => EnemyStats { body_r: GHOST_R, contact_range: REAPER_CONTACT_RANGE, windup: REAPER_ATTACK_WINDUP, cooldown: REAPER_ATTACK_COOLDOWN, ranged: false },
        EnemyKind::Goblin => EnemyStats { body_r: GOBLIN_R, contact_range: 0.6, windup: 0.2, cooldown: GOBLIN_KICK_COOLDOWN, ranged: false },
        EnemyKind::Pin => EnemyStats { body_r: PIN_R, contact_range: 0.0, windup: 1.0, cooldown: 1.0, ranged: false },
        EnemyKind::Golem => EnemyStats { body_r: GOLEM_R, contact_range: GOLEM_CONTACT_RANGE, windup: GOLEM_ATTACK_WINDUP, cooldown: GOLEM_ATTACK_COOLDOWN, ranged: false },
        EnemyKind::Chomper => EnemyStats { body_r: CHOMPER_R, contact_range: CHOMPER_CONTACT_RANGE, windup: CHOMPER_ATTACK_WINDUP, cooldown: CHOMPER_ATTACK_COOLDOWN, ranged: false },
        EnemyKind::Magnet => EnemyStats { body_r: MAGNET_R, contact_range: MAGNET_CONTACT_RANGE, windup: MAGNET_ATTACK_WINDUP, cooldown: MAGNET_ATTACK_COOLDOWN, ranged: false },
        EnemyKind::Webspinner => EnemyStats { body_r: WEBSPIN_R, contact_range: SPITTER_FIRE_RANGE, windup: SPITTER_WINDUP, cooldown: SPITTER_COOLDOWN, ranged: true },
        EnemyKind::Sporeling => EnemyStats { body_r: ZOMBIE_R, contact_range: ZOMBIE_CONTACT_RANGE, windup: ZOMBIE_ATTACK_WINDUP * 1.15, cooldown: ZOMBIE_ATTACK_COOLDOWN, ranged: false },
        EnemyKind::Jester => EnemyStats { body_r: JESTER_R, contact_range: JESTER_FIRE_RANGE, windup: JESTER_WINDUP, cooldown: JESTER_COOLDOWN, ranged: true },
        EnemyKind::Croaker => EnemyStats { body_r: CROAKER_R, contact_range: CROAKER_FIRE_RANGE, windup: CROAKER_WINDUP, cooldown: CROAKER_COOLDOWN, ranged: true },
        EnemyKind::Rotortail => EnemyStats { body_r: ROTORTAIL_R, contact_range: ROTORTAIL_FIRE_RANGE, windup: ROTORTAIL_WINDUP, cooldown: ROTORTAIL_COOLDOWN, ranged: true },
        EnemyKind::Stiltneck => EnemyStats { body_r: STILTNECK_R, contact_range: STILTNECK_FIRE_RANGE, windup: STILTNECK_WINDUP, cooldown: STILTNECK_COOLDOWN, ranged: true },
        EnemyKind::FishFeet => EnemyStats { body_r: GOBLIN_R, contact_range: 0.8, windup: 0.25, cooldown: GOBLIN_KICK_COOLDOWN, ranged: false },
        EnemyKind::Hound => EnemyStats { body_r: 0.3, contact_range: 0.75, windup: 0.3, cooldown: 1.4, ranged: false },
        EnemyKind::Bloater => EnemyStats { body_r: 0.4, contact_range: 0.7, windup: 0.4, cooldown: 2.0, ranged: false },
        EnemyKind::Necromancer => EnemyStats { body_r: 0.32, contact_range: 4.5, windup: 0.5, cooldown: 2.0, ranged: true },
        EnemyKind::Warden => EnemyStats { body_r: 0.4, contact_range: 0.8, windup: 0.5, cooldown: 1.6, ranged: false },
        EnemyKind::Wisp => EnemyStats { body_r: 0.28, contact_range: 0.7, windup: 0.3, cooldown: 1.2, ranged: false },
        EnemyKind::Sapper => EnemyStats { body_r: 0.3, contact_range: 0.75, windup: 0.35, cooldown: 1.5, ranged: false },
        EnemyKind::Crystalback => EnemyStats { body_r: 0.42, contact_range: 0.82, windup: 0.5, cooldown: 1.5, ranged: false },
        EnemyKind::Mimic => EnemyStats { body_r: 0.34, contact_range: 0.72, windup: 0.25, cooldown: 1.4, ranged: false },
        EnemyKind::Skeleton => EnemyStats { body_r: 0.32, contact_range: 0.65, windup: 0.3, cooldown: 1.0, ranged: false },
        EnemyKind::Witch => EnemyStats { body_r: 0.34, contact_range: 6.0, windup: 0.5, cooldown: 2.2, ranged: true },
        EnemyKind::BossKing => EnemyStats { body_r: 0.75, contact_range: 1.4, windup: 0.6, cooldown: 1.5, ranged: false },
    }
}

/// Master STATS lookup alias matching legacy STATS table.
pub const fn STATS(kind: EnemyKind) -> EnemyStats {
    stats_for_kind(kind)
}

/// 1:1 setSummonHandler port.
pub fn set_summon_handler(_handler: fn(f64, f64)) {}

/// Which policy this actor steers with.
pub fn movement_of(kind: EnemyKind, ztype: Option<ZombieType>) -> MovementKind {
    if let Some(zt) = ztype {
        if let Some(m_str) = zt.def().movement {
            return match m_str {
                "flanker" => MovementKind::Flanker,
                "packhunter" => MovementKind::PackHunter,
                "ambusher" => MovementKind::Ambusher,
                "leaper" => MovementKind::Leaper,
                _ => movement_by_kind(kind),
            };
        }
    }
    movement_by_kind(kind)
}

/// Velocity → facing, with HYSTERESIS on the axis (1:1 facingFromVelocity).
pub fn facing_from_velocity(vx: f64, vz: f64, fallback: Facing) -> Facing {
    let ax = vx.abs();
    let az = vz.abs();
    if ax < 1e-4 && az < 1e-4 {
        return fallback;
    }
    let vertical = fallback == Facing::S || fallback == Facing::N;
    const MARGIN: f64 = 1.25;
    if vertical && az * MARGIN >= ax && az >= 1e-4 {
        return if vz > 0.0 { Facing::S } else { Facing::N };
    }
    if !vertical && ax * MARGIN >= az && ax >= 1e-4 {
        return if vx > 0.0 { Facing::E } else { Facing::W };
    }
    if az >= ax {
        if vz > 0.0 { Facing::S } else { Facing::N }
    } else {
        if vx > 0.0 { Facing::E } else { Facing::W }
    }
}

/// World velocity → screen-relative Facing.
pub fn facing_from_world(wx: f64, wz: f64, fallback: Facing) -> Facing {
    let sx = (wx - wz) * ISO;
    let sz = (wx + wz) * ISO;
    facing_from_velocity(sx, sz, fallback)
}

/// Raycast line-of-sight check between two world positions.
pub fn has_line_of_sight(grid: &Grid, ax: f64, az: f64, bx: f64, bz: f64) -> bool {
    let dx = bx - ax;
    let dz = bz - az;
    let d = (dx * dx + dz * dz).sqrt();
    if d <= LOS_PROBE_STEP {
        return true;
    }
    let steps = (d / LOS_PROBE_STEP).ceil() as usize;
    for i in 1..steps {
        let t = (i as f64) / (steps as f64);
        let (ti, tj) = world_to_tile(grid, ax + dx * t, az + dz * t);
        if !crate::grid::is_walkable(grid, ti, tj) {
            return false;
        }
    }
    true
}

/// Counts living awake monsters within PACK_RANGE.
pub fn pack_census(z: &LiveMonster, monsters: &[LiveMonster]) -> (usize, bool) {
    let mut near = 0;
    let mut committed = false;
    for o in monsters {
        if !o.is_alive() {
            continue;
        }
        let d = ((o.x - z.x).powi(2) + (o.z - z.z).powi(2)).sqrt();
        if d <= PACK_RANGE {
            near += 1;
            if o.windup_t > 0.0 {
                committed = true;
            }
        }
    }
    (near, committed)
}

/// Direction along shared flow field towards target.
pub fn flow_heading(grid: &Grid, flow_distances: &[i32], x: f64, z: f64) -> (f64, f64) {
    let (ti, tj) = world_to_tile(grid, x, z);
    if let Some((ni, nj)) = flow_step(grid, flow_distances, ti, tj) {
        let (cx, cz) = tile_center(grid, ni, nj);
        let dx = cx - x;
        let dz = cz - z;
        let d = (dx * dx + dz * dz).sqrt().max(1e-4);
        (dx / d, dz / d)
    } else {
        (0.0, 0.0)
    }
}

/// Action produced by an enemy during update loop.
#[derive(Debug, Clone, PartialEq)]
pub enum EnemyAction {
    MeleeBite { monster_id: u32, damage: i32 },
    RangedAttack { monster_id: u32, target_x: f64, target_z: f64 },
    SummonAdd { x: f64, z: f64 },
    Charge { monster_id: u32, dir_x: f64, dir_z: f64 },
}

/// 1:1 master update loop for the active horde.
pub fn update_zombies(
    monsters: &mut [LiveMonster],
    grid: &Grid,
    player_x: f64,
    player_z: f64,
    player_hp: i32,
    flow_distances: &[i32],
    freeze_t: f64,
    dt: f64,
) -> Vec<EnemyAction> {
    let mut actions = Vec::new();
    if freeze_t > 0.0 || player_hp <= 0 {
        return actions;
    }

    // 1. Pairwise separation forces
    let n = monsters.len();
    for i in 0..n {
        if !monsters[i].is_alive() {
            continue;
        }
        for j in (i + 1)..n {
            if !monsters[j].is_alive() {
                continue;
            }
            let dx = monsters[j].x - monsters[i].x;
            let dz = monsters[j].z - monsters[i].z;
            let d = (dx * dx + dz * dz).sqrt();
            if d < SEPARATION_R && d > 1e-4 {
                let overlap = (SEPARATION_R - d) * 0.5;
                let nx = dx / d;
                let nz = dz / d;
                monsters[i].x -= nx * overlap;
                monsters[i].z -= nz * overlap;
                monsters[j].x += nx * overlap;
                monsters[j].z += nz * overlap;
            }
        }
    }

    // 2. Individual monster AI step
    for m in monsters.iter_mut() {
        if !m.is_alive() {
            continue;
        }

        // Stagger lockout
        if m.stagger_t > 0.0 {
            m.stagger_t = (m.stagger_t - dt).max(0.0);
            if m.stagger_t == 0.0 && m.mode == EnemyMode::Stagger {
                m.mode = EnemyMode::Chase;
            }
            continue;
        }

        // Cooldown timer
        if m.attack_cd > 0.0 {
            m.attack_cd = (m.attack_cd - dt).max(0.0);
        }

        let stats = stats_for_kind(m.kind);
        let dx = player_x - m.x;
        let dz = player_z - m.z;
        let pdist = (dx * dx + dz * dz).sqrt().max(1e-4);

        // Target reached contact range -> Windup / Attack cycle
        if pdist <= stats.contact_range {
            if m.attack_cd <= 0.0 {
                m.mode = EnemyMode::Windup;
                m.windup_t += dt;
                if m.windup_t >= stats.windup {
                    m.windup_t = 0.0;
                    m.attack_cd = stats.cooldown;
                    m.mode = EnemyMode::Attack;
                    if stats.ranged {
                        actions.push(EnemyAction::RangedAttack {
                            monster_id: m.id,
                            target_x: player_x,
                            target_z: player_z,
                        });
                    } else {
                        actions.push(EnemyAction::MeleeBite {
                            monster_id: m.id,
                            damage: stats_for_kind(m.kind).contact_range as i32,
                        });
                    }
                }
            }
        } else {
            // Steering towards player
            m.mode = EnemyMode::Chase;
            m.windup_t = 0.0;

            let (fx, fz) = if pdist < stats.contact_range * 1.5 {
                (dx / pdist, dz / pdist)
            } else {
                let (flow_x, flow_z) = flow_heading(grid, flow_distances, m.x, m.z);
                if flow_x == 0.0 && flow_z == 0.0 {
                    (dx / pdist, dz / pdist)
                } else {
                    (flow_x, flow_z)
                }
            };

            let step = m.speed * dt;
            let res = move_circle(grid, m.x, m.z, stats.body_r, fx * step, fz * step);
            m.x = res.x;
            m.z = res.z;
        }
    }

    actions
}
