//! ☠ THE REAPER KING — the end-of-run boss that gates the exit portal.
//!
//! Port of `legacy/src/game/pinball-knight/boss.ts` (772 lines).
//!
//! The king is a killable brute wearing the reaper's art, scaled up, with two
//! bespoke threats:
//! - Orbiting Skulls: a ring of bone that wheels around the king and fires projectiles.
//! - Tentacle Slam: a telegraphed ground-pound with growing telegraph ring.
//!
//! PORTS: `boss.ts`

use crate::marble::PINBALL_MAX_SPEED;
use crate::state::{Player, PLAYER_R};

pub const REAPER_SCALE: f64 = 1.35;
pub const BRUTE_R: f64 = 0.42;
pub const KING_SCALE: f64 = REAPER_SCALE * 1.55;
pub const KING_BODY_R: f64 = BRUTE_R * KING_SCALE * 0.86;

pub const KING_WAKE_TILES: f64 = 26.0;
pub const KING_LEASH_TILES: f64 = 34.0;
pub const KING_HOME_TILES: f64 = 2.5;
pub const KING_RETURN_SPEED: f64 = 0.75;

pub const SKULL_COUNT: usize = 5;
pub const SKULL_ORBIT_R: f64 = 1.5;
pub const SKULL_ORBIT_SPEED: f64 = 1.1; // rad/s
pub const SKULL_Y: f64 = 1.5;

pub const SLAM_INTERVAL: f64 = 4.2;
pub const SLAM_TELEGRAPH: f64 = 1.1;
pub const SLAM_RADIUS: f64 = 2.6;
pub const SLAM_DAMAGE: i32 = 2;
pub const SLAM_LAUNCH: f64 = 16.0;

pub const BARRAGE_INTERVAL: f64 = 2.6;
pub const BONE_SPEED: f64 = 9.0;
pub const BONE_DAMAGE: i32 = 1;
pub const BONE_MAX_DIST: f64 = 16.0;
pub const BONE_HIT_R: f64 = 0.55;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlamPhase {
    Idle,
    Telegraph,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SkullState {
    pub phase: f64,
    pub active: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BoneState {
    pub x: f64,
    pub z: f64,
    pub vx: f64,
    pub vz: f64,
    pub dist: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BossAux {
    pub slam_phase: SlamPhase,
    pub slam_t: f64,
    pub slam_x: f64,
    pub slam_z: f64,
    pub orbit_t: f64,
    pub skulls_active: [bool; SKULL_COUNT],
    pub bones: Vec<(f64, f64, f64, f64)>,
    pub opened: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BossState {
    pub x: f64,
    pub z: f64,
    pub vx: f64,
    pub vz: f64,
    pub anchor_x: f64,
    pub anchor_z: f64,
    pub hp: i32,
    pub max_hp: i32,
    pub aggro: bool,
    pub engaged: bool,
    pub returning_home: bool,
    pub skulls: Vec<SkullState>,
    pub bones: Vec<BoneState>,
    pub slam_t: f64,
    pub slam_phase: SlamPhase,
    pub slam_x: f64,
    pub slam_z: f64,
    pub barrage_t: f64,
    pub orbit_t: f64,
    pub opened: bool,
    pub scaled_for: usize,
}

impl BossState {
    pub fn new(anchor_x: f64, anchor_z: f64, hp: i32) -> Self {
        let mut skulls = Vec::with_capacity(SKULL_COUNT);
        for i in 0..SKULL_COUNT {
            skulls.push(SkullState {
                phase: (i as f64 / SKULL_COUNT as f64) * std::f64::consts::TAU,
                active: true,
            });
        }
        Self {
            x: anchor_x,
            z: anchor_z,
            vx: 0.0,
            vz: 0.0,
            anchor_x,
            anchor_z,
            hp,
            max_hp: hp,
            aggro: false,
            engaged: false,
            returning_home: false,
            skulls,
            bones: Vec::new(),
            slam_t: 0.0,
            slam_phase: SlamPhase::Idle,
            slam_x: anchor_x,
            slam_z: anchor_z,
            barrage_t: 0.0,
            orbit_t: 0.0,
            opened: false,
            scaled_for: 1,
        }
    }

    pub fn is_alive(&self) -> bool {
        self.hp > 0
    }

    pub fn is_active(&self) -> bool {
        self.is_alive() && !self.opened
    }
}

pub fn boss_active(boss: Option<&BossState>) -> bool {
    boss.map_or(false, |b| b.is_active())
}

pub fn spawn_boss(anchor: (f64, f64), hp: i32) -> BossState {
    BossState::new(anchor.0, anchor.1, hp)
}

pub fn boss_engaged(boss: &BossState) -> bool {
    boss.engaged
}

pub fn boss_net_state(boss: &BossState) -> Option<BossAux> {
    if !boss.is_alive() && boss.opened {
        return None;
    }
    let mut skulls_active = [false; SKULL_COUNT];
    for (i, s) in boss.skulls.iter().enumerate().take(SKULL_COUNT) {
        skulls_active[i] = s.active;
    }
    let bones = boss
        .bones
        .iter()
        .map(|b| (b.x, b.z, b.vx, b.vz))
        .collect();

    Some(BossAux {
        slam_phase: boss.slam_phase,
        slam_t: boss.slam_t,
        slam_x: boss.slam_x,
        slam_z: boss.slam_z,
        orbit_t: boss.orbit_t,
        skulls_active,
        bones,
        opened: boss.opened,
    })
}

pub fn apply_remote_boss_aux(boss: &mut BossState, aux: Option<&BossAux>) {
    let Some(aux) = aux else {
        boss.opened = true;
        return;
    };
    boss.slam_phase = aux.slam_phase;
    boss.slam_t = aux.slam_t;
    boss.slam_x = aux.slam_x;
    boss.slam_z = aux.slam_z;
    boss.orbit_t = aux.orbit_t;
    boss.opened = aux.opened;

    for (i, &active) in aux.skulls_active.iter().enumerate().take(SKULL_COUNT) {
        if i < boss.skulls.len() {
            boss.skulls[i].active = active;
        }
    }
}

pub fn update_boss_replica(boss: &mut BossState, dt: f64) {
    boss.orbit_t += SKULL_ORBIT_SPEED * dt;
    for bone in &mut boss.bones {
        bone.x += bone.vx * dt;
        bone.z += bone.vz * dt;
        bone.dist += (bone.vx * bone.vx + bone.vz * bone.vz).sqrt() * dt;
    }
    boss.bones.retain(|b| b.dist < BONE_MAX_DIST);
}

pub fn adopt_boss(boss: &mut BossState, hp: i32, max_hp: i32) {
    boss.hp = hp;
    boss.max_hp = max_hp;
}

pub fn dispose_boss(boss: &mut Option<BossState>) {
    *boss = None;
}

pub fn update_boss(boss: &mut BossState, player: &mut Player, dt: f64) {
    if !boss.is_alive() {
        boss.opened = true;
        return;
    }

    // Leash and engagement logic
    let dx = player.x - boss.x;
    let dz = player.z - boss.z;
    let dist_to_player = (dx * dx + dz * dz).sqrt();

    let anchor_dx = boss.anchor_x - boss.x;
    let anchor_dz = boss.anchor_z - boss.z;
    let dist_to_anchor = (anchor_dx * anchor_dx + anchor_dz * anchor_dz).sqrt();

    if dist_to_anchor > KING_LEASH_TILES {
        boss.engaged = false;
        boss.aggro = false;
        boss.returning_home = true;
    } else if dist_to_player <= KING_WAKE_TILES {
        boss.engaged = true;
        boss.aggro = true;
        boss.returning_home = false;
    }

    if boss.returning_home {
        if dist_to_anchor > KING_HOME_TILES {
            let inv = if dist_to_anchor > 0.0 { 1.0 / dist_to_anchor } else { 1.0 };
            boss.vx = anchor_dx * inv * KING_RETURN_SPEED;
            boss.vz = anchor_dz * inv * KING_RETURN_SPEED;
            boss.x += boss.vx * dt;
            boss.z += boss.vz * dt;
        } else {
            boss.returning_home = false;
        }
    }

    // Orbiting skulls ticking
    boss.orbit_t += SKULL_ORBIT_SPEED * dt;

    // Bone projectile barrage
    boss.barrage_t += dt;
    if boss.engaged && boss.barrage_t >= BARRAGE_INTERVAL {
        boss.barrage_t = 0.0;
        if dist_to_player > 0.0 {
            let inv = 1.0 / dist_to_player;
            boss.bones.push(BoneState {
                x: boss.x,
                z: boss.z,
                vx: dx * inv * BONE_SPEED,
                vz: dz * inv * BONE_SPEED,
                dist: 0.0,
            });
        }
    }

    // Update projectiles & collide with player
    for bone in &mut boss.bones {
        bone.x += bone.vx * dt;
        bone.z += bone.vz * dt;
        bone.dist += (bone.vx * bone.vx + bone.vz * bone.vz).sqrt() * dt;

        let pdx = player.x - bone.x;
        let pdz = player.z - bone.z;
        if pdx * pdx + pdz * pdz < (PLAYER_R + BONE_HIT_R).powi(2) {
            player.hp = (player.hp - BONE_DAMAGE as f64).max(0.0);
            bone.dist = BONE_MAX_DIST + 1.0; // Mark for removal
        }
    }
    boss.bones.retain(|b| b.dist < BONE_MAX_DIST);

    // Tentacle slam ticking
    boss.slam_t += dt;
    match boss.slam_phase {
        SlamPhase::Idle => {
            if boss.engaged && boss.slam_t >= SLAM_INTERVAL {
                boss.slam_phase = SlamPhase::Telegraph;
                boss.slam_t = 0.0;
                boss.slam_x = player.x;
                boss.slam_z = player.z;
            }
        }
        SlamPhase::Telegraph => {
            if boss.slam_t >= SLAM_TELEGRAPH {
                boss.slam_phase = SlamPhase::Idle;
                boss.slam_t = 0.0;
                // Impact
                let slam_dx = player.x - boss.slam_x;
                let slam_dz = player.z - boss.slam_z;
                if slam_dx * slam_dx + slam_dz * slam_dz <= SLAM_RADIUS * SLAM_RADIUS {
                    player.hp = (player.hp - SLAM_DAMAGE as f64).max(0.0);
                    let dist = (slam_dx * slam_dx + slam_dz * slam_dz).sqrt();
                    let inv = if dist > 0.0 { 1.0 / dist } else { 1.0 };
                    player.mom_x = slam_dx * inv;
                    player.mom_z = slam_dz * inv;
                    player.mom_speed = (player.mom_speed + SLAM_LAUNCH).min(PINBALL_MAX_SPEED);
                }
            }
        }
    }
}
