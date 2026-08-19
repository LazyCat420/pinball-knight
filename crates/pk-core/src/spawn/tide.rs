//! The Tide — rolling monster reinforcements maintaining tactical floor pressure.
//!
//! Port of `legacy/src/game/pinball-knight/spawn/tide.ts` (262 lines).
//!
//! PORTS: `spawn/tide.ts`

use std::sync::RwLock;

use crate::constants::enemies::*;
use crate::grid::{is_walkable, tile_center, Grid};
use crate::maze::track_launch::TilePos;
use crate::monsters::types::LiveMonster;

pub fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
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
