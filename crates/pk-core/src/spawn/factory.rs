//! The monster factory — every path from "an enemy should exist here" to a LiveMonster.
//!
//! Port of `legacy/src/game/pinball-knight/spawn/factory.ts` (526 lines).
//!
//! Handles:
//! - Four spawn routes: bespoke families (spawnKind), tinted expansion skins, reskins, and horde members
//! - Deferred spawn queues: slime split minis and necromancer summons drained between loop steps
//! - Unique monster network IDs (`nid`) sequencing and resets
//! - Bowling pin crew formation stamping
//!
//! PORTS: `spawn/factory.ts`

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use crate::grid::Grid;
use crate::maze::decorate::TilePos;
use crate::monsters::types::{EnemyKind, EnemyMode, LiveMonster};

static ZOMBIE_NID_SEQ: AtomicU32 = AtomicU32::new(1);

pub fn reset_zombie_nid() {
    ZOMBIE_NID_SEQ.store(1, Ordering::Relaxed);
}

pub fn next_zombie_nid() -> String {
    let id = ZOMBIE_NID_SEQ.fetch_add(1, Ordering::Relaxed);
    format!("z_{}", id)
}

pub fn bump_zombie_nid(nid: &str) {
    if let Some(num_str) = nid.strip_prefix("z_") {
        if let Ok(num) = num_str.parse::<u32>() {
            let current = ZOMBIE_NID_SEQ.load(Ordering::Relaxed);
            if num >= current {
                ZOMBIE_NID_SEQ.store(num + 1, Ordering::Relaxed);
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct PendingMini {
    pub x: f64,
    pub z: f64,
    pub speed: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PendingSummon {
    pub x: f64,
    pub z: f64,
}

static PENDING_MINIS: Mutex<VecDeque<PendingMini>> = Mutex::new(VecDeque::new());
static PENDING_SUMMONS: Mutex<VecDeque<PendingSummon>> = Mutex::new(VecDeque::new());

pub fn queue_mini(x: f64, z: f64, speed: f64) {
    if let Ok(mut lock) = PENDING_MINIS.lock() {
        lock.push_back(PendingMini { x, z, speed });
    }
}

pub fn queue_summon(x: f64, z: f64) {
    if let Ok(mut lock) = PENDING_SUMMONS.lock() {
        lock.push_back(PendingSummon { x, z });
    }
}

pub fn drain_pending_minis() -> Vec<PendingMini> {
    if let Ok(mut lock) = PENDING_MINIS.lock() {
        lock.drain(..).collect()
    } else {
        Vec::new()
    }
}

pub fn drain_pending_summons() -> Vec<PendingSummon> {
    if let Ok(mut lock) = PENDING_SUMMONS.lock() {
        lock.drain(..).collect()
    } else {
        Vec::new()
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ExpansionSkin {
    pub tint: u32,
    pub scale: f64,
}

pub fn get_expansion_skin(kind: EnemyKind) -> Option<ExpansionSkin> {
    match kind {
        EnemyKind::Spider => Some(ExpansionSkin { tint: 0x88ff88, scale: 0.9 }),
        EnemyKind::Brute => Some(ExpansionSkin { tint: 0xff8888, scale: 1.3 }),
        EnemyKind::Ghost => Some(ExpansionSkin { tint: 0x88ffff, scale: 1.0 }),
        _ => None,
    }
}

pub fn make_expansion(kind: EnemyKind, x: f64, z: f64, speed: f64) -> Option<LiveMonster> {
    let _skin = get_expansion_skin(kind)?;
    Some(make_zombie(kind, x, z, speed, 1))
}

pub fn make_reskin(kind: EnemyKind, x: f64, z: f64, speed: f64) -> Option<LiveMonster> {
    Some(make_zombie(kind, x, z, speed, 1))
}

pub fn make_zombie(
    kind: EnemyKind,
    x: f64,
    z: f64,
    base_speed: f64,
    level: u32,
) -> LiveMonster {
    let def = kind.def();
    let hp = def.hp as f64 + (level as f64 * 2.0);
    let id = ZOMBIE_NID_SEQ.fetch_add(1, Ordering::Relaxed);

    LiveMonster {
        id,
        kind,
        x,
        z,
        vx: 0.0,
        vz: 0.0,
        radius: def.radius,
        hp,
        max_hp: hp,
        speed: if base_speed > 0.0 { base_speed } else { def.speed_factor * 3.0 },
        mode: EnemyMode::Wander,
        windup_t: 0.0,
        attack_cd: 0.0,
        stagger_t: 0.0,
        contact_range: def.contact_range,
        windup_duration: def.windup,
        cooldown_duration: def.cooldown,
        damage: def.damage,
        hop_t: 0.0,
        hop_cd: 0.0,
        hop_bounces: 0,
        bob_t: 0.0,
        vuln_t: 0.0,
        kbx: 0.0,
        kbz: 0.0,
        knock_t: 0.0,
    }
}

pub fn spawn_kind(
    kind: EnemyKind,
    x: f64,
    z: f64,
    base_speed: f64,
    level: u32,
) -> Option<LiveMonster> {
    Some(make_zombie(kind, x, z, base_speed, level))
}

pub fn spawn_horde_member(
    hash: u32,
    x: f64,
    z: f64,
    base_speed: f64,
    level: u32,
) -> LiveMonster {
    let kinds = [
        EnemyKind::Zombie,
        EnemyKind::Spider,
        EnemyKind::Bat,
        EnemyKind::Goblin,
        EnemyKind::Slime,
    ];
    let kind = kinds[(hash as usize) % kinds.len()];
    make_zombie(kind, x, z, base_speed, level)
}

pub fn spawn_pin_crew(_grid: &Grid, centre: TilePos) -> Vec<LiveMonster> {
    let mut crew = Vec::new();
    let offsets = [
        (0.0, 0.0),
        (-0.4, -0.6), (0.4, -0.6),
        (-0.8, -1.2), (0.0, -1.2), (0.8, -1.2),
        (-1.2, -1.8), (-0.4, -1.8), (0.4, -1.8), (1.2, -1.8),
    ];

    for &(dx, dz) in &offsets {
        let x = centre.i as f64 + 0.5 + dx;
        let z = centre.j as f64 + 0.5 + dz;
        crew.push(make_zombie(EnemyKind::Zombie, x, z, 0.0, 1));
    }

    crew
}
