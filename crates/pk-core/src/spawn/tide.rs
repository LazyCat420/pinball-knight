//! The Tide — rolling monster reinforcements maintaining tactical floor pressure.
//!
//! Port of `legacy/src/game/pinball-knight/spawn/tide.ts` (262 lines).
//!
//! PORTS: `spawn/tide.ts`

use std::sync::RwLock;

use crate::constants::enemies::*;
use crate::grid::{is_walkable, tile_center, world_to_tile, Grid};
use crate::maze::track_launch::TilePos;
use crate::monsters::types::{EnemyKind, LiveMonster};

pub fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

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

#[derive(Debug, Clone, Default)]
pub struct TideRuntime {
    pub tiles: Vec<TilePos>,
    pub base: usize,
    pub timer: f64,
    pub stirred: bool,
    pub floor_t: f64,
}

static TIDE_GLOBAL: RwLock<TideRuntime> = RwLock::new(TideRuntime {
    tiles: Vec::new(),
    base: 0,
    timer: 0.0,
    stirred: false,
    floor_t: 0.0,
});

pub fn arm_tide(spawn_tiles: &[TilePos]) {
    let mut w = TIDE_GLOBAL.write().unwrap();
    w.tiles = spawn_tiles.to_vec();
    w.base = 20;
    w.timer = 0.0;
    w.stirred = false;
    w.floor_t = 0.0;
}

pub fn tide_intensity() -> f64 {
    let r = TIDE_GLOBAL.read().unwrap();
    let t = (r.floor_t - TIDE_GRACE) / TIDE_RAMP;
    t.clamp(0.0, 1.0)
}

#[derive(Debug, Clone, PartialEq)]
pub struct TideDemand {
    pub intensity: f64,
    pub target: usize,
    pub live: usize,
    pub pulse: usize,
}

pub fn tide_demand(live_monsters: usize) -> TideDemand {
    let r = TIDE_GLOBAL.read().unwrap();
    let intensity = tide_intensity();
    let target = ((r.base as f64) * lerp(TIDE_SHARE_CALM, TIDE_SHARE_PEAK, intensity)).round() as usize;
    let deficit = if target > live_monsters {
        target - live_monsters
    } else {
        0
    };
    let pulse_target = (lerp(TIDE_PULSE_CALM as f64, TIDE_PULSE_PEAK as f64, intensity)).round() as usize;
    let pulse = deficit.min(pulse_target);

    TideDemand {
        intensity,
        target,
        live: live_monsters,
        pulse,
    }
}

pub fn pick_spawn_tile(
    g: &Grid,
    px: f64,
    pz: f64,
    tide_tiles: &[TilePos],
    mut rng_draw: impl FnMut() -> f64,
) -> Option<(f64, f64)> {
    if tide_tiles.is_empty() {
        return None;
    }
    let min_d2 = (TIDE_SPAWN_MIN_TILES as f64) * (TIDE_SPAWN_MIN_TILES as f64);
    let max_d2 = (TIDE_SPAWN_MAX_TILES as f64) * (TIDE_SPAWN_MAX_TILES as f64);

    let mut seen = 0;
    let mut pick: Option<(f64, f64)> = None;
    let mut spare: Option<(f64, f64)> = None;
    let mut spare_d2 = f64::INFINITY;

    for t in tide_tiles {
        if !is_walkable(g, t.i, t.j) {
            continue;
        }
        let c = tile_center(g, t.i, t.j);
        let dx = c.0 - px;
        let dz = c.1 - pz;
        let d2 = dx * dx + dz * dz;

        if d2 < min_d2 {
            continue;
        }
        if d2 > max_d2 {
            if d2 < spare_d2 {
                spare_d2 = d2;
                spare = Some(c);
            }
            continue;
        }
        seen += 1;
        if rng_draw() * (seen as f64) < 1.0 {
            pick = Some(c);
        }
    }

    pick.or(spare)
}

pub fn tick_tide(dt: f64) {
    let mut w = TIDE_GLOBAL.write().unwrap();
    w.floor_t += dt;
    w.timer -= dt;
}

pub fn reap_corpses(monsters: &mut Vec<LiveMonster>) {
    let mut dead_count = 0;
    monsters.retain(|m| {
        if m.is_alive() {
            true
        } else {
            dead_count += 1;
            dead_count <= CORPSE_BUDGET
        }
    });
}

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

            let mut candidates = Vec::new();
            for dj in -20..=20 {
                for di in -20..=20 {
                    let ti = pi + di;
                    let tj = pj + dj;
                    let dist = ((di * di + dj * dj) as f64).sqrt();
                    if dist >= (TIDE_SPAWN_MIN_TILES as f64)
                        && dist <= (TIDE_SPAWN_MAX_TILES as f64)
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
