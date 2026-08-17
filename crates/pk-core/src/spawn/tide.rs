//! The Tide — rolling monster reinforcements maintaining tactical floor pressure.
//!
//! PORTS: `spawn/tide.ts`

use crate::grid::{is_walkable, tile_center, world_to_tile, Grid};
use crate::monsters::types::{EnemyKind, LiveMonster};

pub const CORPSE_BUDGET: usize = 32;
pub const TIDE_GRACE: f64 = 15.0;
pub const TIDE_INTERVAL_CALM: f64 = 12.0;
pub const TIDE_INTERVAL_PEAK: f64 = 4.0;
pub const TIDE_PULSE_CALM: usize = 2;
pub const TIDE_PULSE_PEAK: usize = 5;
pub const TIDE_RAMP: f64 = 90.0;
pub const TIDE_SHARE_CALM: f64 = 0.45;
pub const TIDE_SHARE_PEAK: f64 = 0.90;
pub const TIDE_SPAWN_MIN_TILES: f64 = 8.0;
pub const TIDE_SPAWN_MAX_TILES: f64 = 18.0;

#[derive(Debug, Clone, PartialEq)]
pub struct TideState {
    pub active: bool,
    pub timer: f64,
    pub floor_age: f64,
    pub base_horde: usize,
    pub next_id: u32,
}

impl Default for TideState {
    fn default() -> Self {
        Self {
            active: true,
            timer: 0.0,
            floor_age: 0.0,
            base_horde: 20,
            next_id: 1000,
        }
    }
}

impl TideState {
    pub fn new(base_horde: usize, start_id: u32) -> Self {
        Self {
            active: true,
            timer: 0.0,
            floor_age: 0.0,
            base_horde,
            next_id: start_id,
        }
    }
}

/// Reaps dead corpses exceeding the allocated `CORPSE_BUDGET` to prevent memory leaks and draw overhead.
pub fn reap_corpses(monsters: &mut Vec<LiveMonster>) {
    let mut dead_count = 0;
    // Iterate from newest to oldest corpses, keeping the latest up to CORPSE_BUDGET
    monsters.retain(|m| {
        if m.is_alive() {
            true
        } else {
            dead_count += 1;
            dead_count <= CORPSE_BUDGET
        }
    });
}

/// Steps the tide simulation, checking if the active live horde is below target threshold and spawning reinforcements.
pub fn step_tide(
    tide: &mut TideState,
    monsters: &mut Vec<LiveMonster>,
    grid: &Grid,
    player_x: f64,
    player_z: f64,
    dt: f64,
) -> Vec<LiveMonster> {
    if !tide.active {
        return Vec::new();
    }

    tide.floor_age += dt;
    tide.timer += dt;

    if tide.floor_age < TIDE_GRACE {
        return Vec::new();
    }

    let alpha = ((tide.floor_age - TIDE_GRACE) / TIDE_RAMP).clamp(0.0, 1.0);
    let interval = TIDE_INTERVAL_CALM + alpha * (TIDE_INTERVAL_PEAK - TIDE_INTERVAL_CALM);
    let target_share = TIDE_SHARE_CALM + alpha * (TIDE_SHARE_PEAK - TIDE_SHARE_CALM);
    let target_count = (tide.base_horde as f64 * target_share).round() as usize;
    let pulse =
        TIDE_PULSE_CALM + (alpha * (TIDE_PULSE_PEAK - TIDE_PULSE_CALM) as f64).round() as usize;

    let mut spawned = Vec::new();

    if tide.timer >= interval {
        tide.timer = 0.0;

        let live_count = monsters.iter().filter(|m| m.is_alive()).count();
        if live_count < target_count {
            let needed = (target_count - live_count).min(pulse);
            let (pi, pj) = world_to_tile(grid, player_x, player_z);

            // Find candidate walkable tiles in the spawn ring
            let mut candidates = Vec::new();
            for dj in -20..=20 {
                for di in -20..=20 {
                    let ti = pi + di;
                    let tj = pj + dj;
                    let dist = ((di * di + dj * dj) as f64).sqrt();
                    if dist >= TIDE_SPAWN_MIN_TILES
                        && dist <= TIDE_SPAWN_MAX_TILES
                        && is_walkable(grid, ti, tj)
                    {
                        candidates.push((ti, tj));
                    }
                }
            }

            if !candidates.is_empty() {
                for i in 0..needed {
                    let tile = candidates[(i * 7) % candidates.len()];
                    let (sx, sz) = tile_center(grid, tile.0, tile.1);
                    tide.next_id += 1;
                    let new_monster = LiveMonster::new(tide.next_id, EnemyKind::Zombie, sx, sz);
                    monsters.push(new_monster.clone());
                    spawned.push(new_monster);
                }
            }
        }
    }

    reap_corpses(monsters);

    spawned
}
