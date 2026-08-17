//! Dungeon NPCs — Magician room shuffler, Speed Witch buff, Oracle Frog navigator, and Merchant Cart.
//!
//! Port of `legacy/src/game/pinball-knight/entities/npc.ts` (408 lines).
//!
//! Handles:
//! - Magician visits, bows, and shuffles room furniture
//! - Speed Witch grants spring-legs / speed boost in exchange for half hearts
//! - Oracle Frog traces BFS ember path to stairs
//! - Wandering Merchant cart fleeing from player until caught to open shop
//!
//! PORTS: `entities/npc.ts`

use std::sync::Mutex;
use crate::collide::move_circle;
use crate::flow_field::bfs_distances;
use crate::grid::{idx, is_walkable, world_to_tile, Grid};
use crate::maze::flow_loops::FlowPart;
use crate::rng::Mulberry32;

pub const MAGICIAN_PERIOD: f64 = 45.0;
pub const MAGICIAN_JITTER: f64 = 15.0;
pub const MAGICIAN_BOW: f64 = 1.2;
pub const MAGICIAN_LINGER: f64 = 3.0;
pub const TRICK_RADIUS: f64 = 8.0;
pub const TRICK_SAFE_RADIUS: f64 = 2.0;
pub const TRICK_PART_SWAPS: usize = 3;

pub const WITCH_BUFF_TIME: f64 = 18.0;
pub const FROG_COOLDOWN: f64 = 30.0;

pub const MERCHANT_SPEED: f64 = 2.8;
pub const MERCHANT_FLEE_SPEED: f64 = 4.8;
pub const MERCHANT_FLEE_RANGE: f64 = 5.0;
pub const MERCHANT_CATCH_RANGE: f64 = 1.2;

static MERCHANT_HANDLER: Mutex<Option<Box<dyn Fn() + Send + Sync>>> = Mutex::new(None);

pub fn set_merchant_caught_handler(fn_handler: impl Fn() + Send + Sync + 'static) {
    if let Ok(mut lock) = MERCHANT_HANDLER.lock() {
        *lock = Some(Box::new(fn_handler));
    }
}

pub fn roll_magician_clock(rng: &mut Mulberry32) -> f64 {
    MAGICIAN_PERIOD + (rng.next_f64() * 2.0 - 1.0) * MAGICIAN_JITTER
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct NpcManager {
    pub frog: Option<FrogActor>,
    pub witch: Option<WitchActor>,
    pub merchant: Option<MerchantActor>,
    pub magician: MagicianActor,
}

static NPC_STATE: Mutex<Option<NpcManager>> = Mutex::new(None);

pub fn spawn_frog(i: i32, j: i32) {
    if let Ok(mut lock) = NPC_STATE.lock() {
        let mgr = lock.get_or_insert_with(NpcManager::default);
        mgr.frog = Some(FrogActor {
            x: i as f64 + 0.5,
            z: j as f64 + 0.5,
            cooldown: 0.0,
            active: true,
        });
    }
}

pub fn spawn_merchant(i: i32, j: i32) {
    if let Ok(mut lock) = NPC_STATE.lock() {
        let mgr = lock.get_or_insert_with(NpcManager::default);
        mgr.merchant = Some(MerchantActor {
            x: i as f64 + 0.5,
            z: j as f64 + 0.5,
            vx: 0.0,
            vz: 0.0,
            caught: false,
        });
    }
}

pub fn spawn_witch(x: f64, z: f64) {
    if let Ok(mut lock) = NPC_STATE.lock() {
        let mgr = lock.get_or_insert_with(NpcManager::default);
        mgr.witch = Some(WitchActor {
            x,
            z,
            revealed: true,
            used: false,
            interacted: false,
        });
    }
}

pub fn update_npcs(dt: f64) {
    if let Ok(mut lock) = NPC_STATE.lock() {
        if let Some(ref mut mgr) = *lock {
            if let Some(ref mut frog) = mgr.frog {
                frog.cooldown = (frog.cooldown - dt).max(0.0);
            }
        }
    }
}

pub fn dispose_npcs() {
    if let Ok(mut lock) = NPC_STATE.lock() {
        *lock = None;
    }
    if let Ok(mut lock) = MERCHANT_HANDLER.lock() {
        *lock = None;
    }
}

// ── Actors & Step Functions ──────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MagicianPhase {
    Hidden,
    Appearing,
    Bowing,
    Trick,
    Vanishing,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MagicianActor {
    pub x: f64,
    pub z: f64,
    pub phase: MagicianPhase,
    pub timer: f64,
    pub next_visit: f64,
}

impl Default for MagicianActor {
    fn default() -> Self {
        Self {
            x: 0.0,
            z: 0.0,
            phase: MagicianPhase::Hidden,
            timer: 0.0,
            next_visit: MAGICIAN_PERIOD,
        }
    }
}

pub type SpeedWitchActor = WitchActor;
pub type OracleFrogActor = FrogActor;

#[derive(Debug, Clone, PartialEq)]
pub struct WitchActor {
    pub x: f64,
    pub z: f64,
    pub revealed: bool,
    pub used: bool,
    pub interacted: bool,
}

pub fn touch_witch(witch: &mut WitchActor, player_x: f64, player_z: f64) -> bool {
    if witch.interacted || witch.used {
        return false;
    }
    let dx = witch.x - player_x;
    let dz = witch.z - player_z;
    if dx * dx + dz * dz <= 1.0 {
        witch.interacted = true;
        witch.used = true;
        true
    } else {
        false
    }
}

pub fn check_witch_touch(witch: &mut WitchActor, player_x: f64, player_z: f64) -> bool {
    if !witch.revealed {
        return false;
    }
    touch_witch(witch, player_x, player_z)
}

pub fn step_oracle_frog(
    frog: &mut FrogActor,
    grid: &Grid,
    stairs: (i32, i32),
    player_x: f64,
    player_z: f64,
    _dt: f64,
) -> Option<Vec<(i32, i32)>> {
    touch_frog(frog, grid, player_x, player_z, stairs.0, stairs.1)
}

pub fn step_magician(
    magician: &mut MagicianActor,
    parts: &mut [FlowPart],
    player_x: f64,
    player_z: f64,
    dt: f64,
) -> bool {
    let mut rng = Mulberry32::new(42);
    step_magician_with_rng(magician, parts, player_x, player_z, dt, &mut rng)
}

pub fn step_magician_with_rng(
    magician: &mut MagicianActor,
    parts: &mut [FlowPart],
    player_x: f64,
    player_z: f64,
    dt: f64,
    rng: &mut Mulberry32,
) -> bool {
    match magician.phase {
        MagicianPhase::Hidden => {
            magician.timer += dt;
            if magician.timer >= magician.next_visit {
                magician.phase = MagicianPhase::Appearing;
                magician.timer = 0.0;
                magician.x = player_x + 3.0;
                magician.z = player_z;
            }
        }
        MagicianPhase::Appearing => {
            magician.timer += dt;
            if magician.timer >= 0.5 {
                magician.phase = MagicianPhase::Bowing;
                magician.timer = 0.0;
            }
        }
        MagicianPhase::Bowing => {
            magician.timer += dt;
            if magician.timer >= MAGICIAN_BOW {
                magician.phase = MagicianPhase::Trick;
                magician.timer = 0.0;
            }
        }
        MagicianPhase::Trick => {
            let mut eligible = Vec::new();
            for (idx, p) in parts.iter().enumerate() {
                let dx = p.pos.0 as f64 - player_x;
                let dz = p.pos.1 as f64 - player_z;
                let dist = (dx * dx + dz * dz).sqrt();
                if dist >= TRICK_SAFE_RADIUS && dist <= TRICK_RADIUS {
                    eligible.push(idx);
                }
            }

            if eligible.len() >= 2 {
                for _ in 0..TRICK_PART_SWAPS.min(eligible.len() / 2) {
                    let i1 = (rng.next_f64() * eligible.len() as f64) as usize;
                    let i2 = (rng.next_f64() * eligible.len() as f64) as usize;
                    if i1 != i2 {
                        let idx1 = eligible[i1];
                        let idx2 = eligible[i2];
                        let tmp_pos = parts[idx1].pos;
                        parts[idx1].pos = parts[idx2].pos;
                        parts[idx2].pos = tmp_pos;
                    }
                }
            }

            magician.phase = MagicianPhase::Vanishing;
            magician.timer = 0.0;
            return true;
        }
        MagicianPhase::Vanishing => {
            magician.timer += dt;
            if magician.timer >= 0.8 {
                magician.phase = MagicianPhase::Hidden;
                magician.timer = 0.0;
                magician.next_visit = roll_magician_clock(rng);
            }
        }
    }
    false
}



#[derive(Debug, Clone, PartialEq)]
pub struct FrogActor {
    pub x: f64,
    pub z: f64,
    pub cooldown: f64,
    pub active: bool,
}

pub fn touch_frog(
    frog: &mut FrogActor,
    grid: &Grid,
    player_x: f64,
    player_z: f64,
    stairs_x: i32,
    stairs_z: i32,
) -> Option<Vec<(i32, i32)>> {
    if frog.cooldown > 0.0 {
        return None;
    }

    let dx = frog.x - player_x;
    let dz = frog.z - player_z;
    if dx * dx + dz * dz <= 1.2 {
        frog.cooldown = FROG_COOLDOWN;

        let dist_map = bfs_distances(grid, stairs_x, stairs_z);
        let start_tile = world_to_tile(grid, player_x, player_z);
        let mut cur_x = start_tile.0;
        let mut cur_z = start_tile.1;

        let mut path = Vec::new();
        for _ in 0..100 {
            path.push((cur_x, cur_z));
            if (cur_x, cur_z) == (stairs_x, stairs_z) {
                break;
            }

            let mut best_dist = dist_map[idx(grid, cur_x, cur_z)];
            let mut best_next = (cur_x, cur_z);

            for (di, dj) in [(0, 1), (0, -1), (1, 0), (-1, 0)] {
                let ni = cur_x + di;
                let nj = cur_z + dj;
                if ni >= 0 && nj >= 0 && is_walkable(grid, ni, nj) {
                    let nd = dist_map[idx(grid, ni, nj)];
                    if nd < best_dist {
                        best_dist = nd;
                        best_next = (ni, nj);
                    }
                }
            }

            if best_next == (cur_x, cur_z) {
                break;
            }
            cur_x = best_next.0;
            cur_z = best_next.1;
        }

        return Some(path);
    }

    None
}

#[derive(Debug, Clone, PartialEq)]
pub struct MerchantActor {
    pub x: f64,
    pub z: f64,
    pub vx: f64,
    pub vz: f64,
    pub caught: bool,
}

pub fn step_merchant(
    merchant: &mut MerchantActor,
    grid: &Grid,
    player_x: f64,
    player_z: f64,
    dt: f64,
) -> bool {
    if merchant.caught {
        return false;
    }

    let dx = merchant.x - player_x;
    let dz = merchant.z - player_z;
    let dist = (dx * dx + dz * dz).sqrt();

    if dist <= MERCHANT_CATCH_RANGE {
        merchant.caught = true;
        merchant.vx = 0.0;
        merchant.vz = 0.0;
        if let Ok(lock) = MERCHANT_HANDLER.lock() {
            if let Some(ref cb) = *lock {
                cb();
            }
        }
        return true;
    }

    if dist <= MERCHANT_FLEE_RANGE && dist > 0.001 {
        let ndx = dx / dist;
        let ndz = dz / dist;
        merchant.vx = ndx * MERCHANT_FLEE_SPEED;
        merchant.vz = ndz * MERCHANT_FLEE_SPEED;
    } else {
        merchant.vx *= 0.9;
        merchant.vz *= 0.9;
    }

    let next_pos = move_circle(
        grid,
        merchant.x,
        merchant.z,
        0.4,
        merchant.vx * dt,
        merchant.vz * dt,
    );
    merchant.x = next_pos.x;
    merchant.z = next_pos.z;

    false
}
