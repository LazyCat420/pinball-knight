//! CO-OP DUNGEON LAYER — Multi-peer floor authority election, entity replication, and marble interaction.
//!
//! PORTS: `coop.ts`

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;

pub const SNAP_INTERVAL: f64 = 0.1; // 10Hz snapshot broadcast
pub const GHOST_LERP: f64 = 10.0;
pub const CONTACT_RANGE: f64 = 0.62;
pub const PLAYER_BOUNCE_R: f64 = 0.5;

static IS_COOP_ACTIVE: AtomicBool = AtomicBool::new(false);
static IS_AUTHORITY: AtomicBool = AtomicBool::new(true);
static COOP_FLOOR: AtomicU32 = AtomicU32::new(1);
static COOP_SEED: Mutex<Option<u64>> = Mutex::new(None);

#[derive(Clone, Debug, PartialEq)]
pub struct SnapZombie {
    pub nid: String,
    pub kind: String,
    pub x: f64,
    pub z: f64,
    pub hp: i32,
    pub max_hp: Option<i32>,
    pub mode: String,
    pub is_boss: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SnapItem {
    pub nid: String,
    pub kind: String,
    pub x: f64,
    pub z: f64,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct WorldSnapshot {
    pub floor: u32,
    pub zombies: Vec<SnapZombie>,
    pub items: Vec<SnapItem>,
    pub exit_unlocked: bool,
}

#[derive(Clone, Debug, Default)]
pub struct CoopHooks;

pub fn set_coop_hooks(_h: CoopHooks) {}

pub fn enemy_authority_is_me() -> bool {
    IS_AUTHORITY.load(Ordering::Relaxed)
}

pub fn is_replica() -> bool {
    !enemy_authority_is_me()
}

pub fn is_coop() -> bool {
    IS_COOP_ACTIVE.load(Ordering::Relaxed)
}

pub fn coop_seed() -> Option<u64> {
    if let Ok(lock) = COOP_SEED.lock() {
        *lock
    } else {
        None
    }
}

pub fn init_coop() {
    IS_COOP_ACTIVE.store(true, Ordering::Relaxed);
    IS_AUTHORITY.store(true, Ordering::Relaxed);
    if let Ok(mut lock) = COOP_SEED.lock() {
        *lock = Some(12345678);
    }
}

pub fn set_coop_floor(level: u32) {
    COOP_FLOOR.store(level, Ordering::Relaxed);
}

pub fn end_coop() {
    IS_COOP_ACTIVE.store(false, Ordering::Relaxed);
    if let Ok(mut lock) = COOP_SEED.lock() {
        *lock = None;
    }
}

pub fn update_coop(_dt: f64) {}

pub fn coop_forward_damage(_z_id: u32, _dmg: f64, _dx: f64, _dz: f64, _push: f64) {}

pub fn coop_broadcast_kill(_z_id: u32) {}

pub fn coop_item_taken(_item_id: u32) {}

pub fn coop_announce_death() {}

pub struct CoopAuthority;

impl CoopAuthority {
    /// Elects the floor authority as the lexicographically smallest peer ID among participants.
    pub fn elect_authority(peer_ids: &[&str]) -> Option<String> {
        peer_ids.iter().min().map(|s| s.to_string())
    }
}

pub struct MarbleCollision;

impl MarbleCollision {
    /// Resolves elastic collision impulse between two rolling marble knights.
    pub fn bounce_marbles(
        pos_a: (f64, f64),
        vel_a: &mut (f64, f64),
        pos_b: (f64, f64),
        vel_b: &mut (f64, f64),
        radius: f64,
    ) -> bool {
        let dx = pos_b.0 - pos_a.0;
        let dz = pos_b.1 - pos_a.1;
        let dist_sq = dx * dx + dz * dz;
        let r_sum = radius * 2.0;

        if dist_sq >= r_sum * r_sum || dist_sq < 1e-6 {
            return false;
        }

        let dist = dist_sq.sqrt();
        let nx = dx / dist;
        let nz = dz / dist;

        let kx = vel_a.0 - vel_b.0;
        let kz = vel_a.1 - vel_b.1;
        let p = 2.0 * (nx * kx + nz * kz) / 2.0;

        if p <= 0.0 {
            return false;
        }

        vel_a.0 -= p * nx;
        vel_a.1 -= p * nz;
        vel_b.0 += p * nx;
        vel_b.1 += p * nz;

        true
    }
}
