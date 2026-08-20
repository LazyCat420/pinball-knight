//! SECRET WALLS — the smash-through payoff.
//!
//! Port of `legacy/src/game/pinball-knight/secrets.ts` (410 lines).
//!
//! PORTS: `secrets.ts`

use std::f64::consts::PI;

use crate::grid::{
    at, is_walkable, set_surface, set_tile, shape_at, Grid, T_CRACKED, T_FLOOR, T_WALL,
};
use crate::maze::track_launch::TilePos;
use crate::tile_shape::SHAPE_FULL;

pub const REVOLVE_TIME: f64 = 0.85;
pub const REVOLVE_SWEEP: f64 = PI * 1.15;
pub const WITCH_CHANCE: f64 = 0.15;
pub const WALL_BREAK_DEPTH: usize = 2;
pub const SECRET_BREAK_SPEED: f64 = 18.0;

pub const RUBBLE_LOOT: &[&[&str]] = &[
    &["gold", "health"],
    &["gold", "rage"],
    &["gold", "haste"],
    &["gold", "shield"],
];

const BAND_OFFSETS: [(i32, i32); 4] = [(0, 0), (1, 0), (0, 1), (1, 1)];

#[derive(Debug, Clone, PartialEq)]
pub struct RevolvingDoor {
    pub x: f64,
    pub z: f64,
    pub t: f64,
    pub rotation_y: f64,
    pub position_y: f64,
    pub opacity: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SecretDoorFlightInfo {
    pub deg: i32,
    pub y: f64,
    pub opacity: f64,
    pub t: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SecretBand {
    pub i: i32,
    pub j: i32,
    pub x: f64,
    pub z: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SecretBreakResult {
    pub band: SecretBand,
    pub loot: Vec<&'static str>,
    pub spawn_witch: bool,
}

/// Tick every revolving secret door currently spinning.
pub fn update_secret_doors(revolving: &mut Vec<RevolvingDoor>, dt: f64) {
    let mut k = revolving.len();
    while k > 0 {
        k -= 1;
        let r = &mut revolving[k];
        r.t += dt;
        let p = (r.t / REVOLVE_TIME).min(1.0);
        let ease = 1.0 - (1.0 - p) * (1.0 - p) * (1.0 - p); // cubic ease-out
        r.rotation_y = ease * REVOLVE_SWEEP;
        r.position_y = -ease * 0.35;
        r.opacity = if p < 0.65 {
            1.0
        } else {
            1.0 - (p - 0.65) / 0.35
        };

        if p >= 1.0 {
            revolving.swap_remove(k);
        }
    }
}

/// Every door still turning, as inspectable telemetry numbers.
pub fn secret_doors_in_flight(revolving: &[RevolvingDoor]) -> Vec<SecretDoorFlightInfo> {
    revolving
        .iter()
        .map(|r| SecretDoorFlightInfo {
            deg: ((r.rotation_y * 180.0) / PI).round() as i32,
            y: (r.position_y * 1000.0).round() / 1000.0,
            opacity: (r.opacity * 1000.0).round() / 1000.0,
            t: (r.t * 1000.0).round() / 1000.0,
        })
        .collect()
}

/// Drop every revolving door on level teardown.
pub fn dispose_secret_doors(revolving: &mut Vec<RevolvingDoor>) {
    revolving.clear();
}

/// Stamp 2x2 secret cracked bands on a finished track floor.
pub fn stamp_secret_bands(
    g: &mut Grid,
    rng: &mut impl FnMut() -> f64,
    count: usize,
    spacing: Option<i32>,
    avoid: Option<&dyn Fn(i32, i32) -> bool>,
) -> Vec<TilePos> {
    if count == 0 {
        return Vec::new();
    }
    let space = spacing.unwrap_or(8);

    let plain = |g: &Grid, i: i32, j: i32| -> bool {
        at(g, i, j) == T_WALL
            && shape_at(g, i, j) == SHAPE_FULL
            && !avoid.map_or(false, |f| f(i, j))
    };
    let floor = |g: &Grid, i: i32, j: i32| -> bool { at(g, i, j) == T_FLOOR };

    let mut candidates: Vec<TilePos> = Vec::new();
    let mut j = 2;
    while j + 1 <= g.h - 3 {
        let mut i = 2;
        while i + 1 <= g.w - 3 {
            if plain(g, i, j)
                && plain(g, i + 1, j)
                && plain(g, i, j + 1)
                && plain(g, i + 1, j + 1)
            {
                let horizontal = floor(g, i - 1, j)
                    && floor(g, i - 1, j + 1)
                    && floor(g, i + 2, j)
                    && floor(g, i + 2, j + 1);
                let vertical = floor(g, i, j - 1)
                    && floor(g, i + 1, j - 1)
                    && floor(g, i, j + 2)
                    && floor(g, i + 1, j + 2);
                if horizontal || vertical {
                    candidates.push(TilePos { i, j });
                }
            }
            i += 2;
        }
        j += 2;
    }

    // Fisher-Yates shuffle
    if candidates.len() > 1 {
        for k in (1..candidates.len()).rev() {
            let q = (rng() * (k + 1) as f64).floor() as usize;
            candidates.swap(k, q.min(k));
        }
    }

    let mut picked: Vec<TilePos> = Vec::new();
    for c in candidates {
        if picked.len() >= count {
            break;
        }
        if picked
            .iter()
            .any(|p| (p.i - c.i).abs() + (p.j - c.j).abs() < space)
        {
            continue;
        }
        for (di, dj) in BAND_OFFSETS {
            set_tile(g, c.i + di, c.j + dj, T_CRACKED);
        }
        picked.push(c);
    }

    picked
}

/// Drop any band a later pass sealed in, reverting its tiles to plain wall.
pub fn prune_sealed_bands(g: &mut Grid, secrets: &mut Vec<TilePos>) -> usize {
    let open = |g: &Grid, i: i32, j: i32| -> bool {
        is_walkable(g, i + 1, j)
            || is_walkable(g, i - 1, j)
            || is_walkable(g, i, j + 1)
            || is_walkable(g, i, j - 1)
    };

    let mut dropped = 0;
    let mut k = secrets.len();
    while k > 0 {
        k -= 1;
        let s = secrets[k];
        let mut sealed = false;
        for (di, dj) in BAND_OFFSETS {
            if at(g, s.i + di, s.j + dj) == T_CRACKED && !open(g, s.i + di, s.j + dj) {
                sealed = true;
                break;
            }
        }
        if !sealed {
            continue;
        }
        for (di, dj) in BAND_OFFSETS {
            if at(g, s.i + di, s.j + dj) == T_CRACKED {
                set_tile(g, s.i + di, s.j + dj, T_WALL);
            }
        }
        secrets.swap_remove(k);
        dropped += 1;
    }

    dropped
}

/// Smash the secret band containing tile (i, j).
pub fn smash_secret_at(
    g: &mut Grid,
    secrets: &mut Vec<SecretBand>,
    revolving: &mut Vec<RevolvingDoor>,
    i: i32,
    j: i32,
    witch_spawned: bool,
    rng: &mut impl FnMut() -> f64,
) -> Option<SecretBreakResult> {
    let band_idx = secrets
        .iter()
        .position(|s| i >= s.i && i <= s.i + 1 && j >= s.j && j <= s.j + 1)?;

    let band = secrets.swap_remove(band_idx);

    // Open grid
    for (di, dj) in BAND_OFFSETS {
        set_tile(g, band.i + di, band.j + dj, T_FLOOR);
        set_surface(g, band.i + di, band.j + dj, 0);
    }

    // Start revolving animation
    revolving.push(RevolvingDoor {
        x: band.x,
        z: band.z,
        t: 0.0,
        rotation_y: 0.0,
        position_y: 0.0,
        opacity: 1.0,
    });

    // Loot roll
    let loot_idx = ((rng() * RUBBLE_LOOT.len() as f64).floor() as usize).min(RUBBLE_LOOT.len() - 1);
    let loot = RUBBLE_LOOT[loot_idx].to_vec();

    // Witch spawn roll
    let spawn_witch = !witch_spawned && rng() < WITCH_CHANCE;

    Some(SecretBreakResult {
        band,
        loot,
        spawn_witch,
    })
}

/// How many consecutive ordinary wall tiles a smash would break before reaching open corridor.
pub fn wall_run_depth(g: &Grid, i: i32, j: i32, ddx: f64, ddz: f64) -> usize {
    if i <= 0 || j <= 0 || i >= g.w - 1 || j >= g.h - 1 {
        return 0;
    }
    if at(g, i, j) != T_WALL {
        return 0;
    }
    let si = if ddx > 0.0 { 1 } else if ddx < 0.0 { -1 } else { 0 };
    let sj = if ddz > 0.0 { 1 } else if ddz < 0.0 { -1 } else { 0 };
    for d in 1..=WALL_BREAK_DEPTH {
        let ni = i + si * (d as i32);
        let nj = j + sj * (d as i32);
        if ni <= 0 || nj <= 0 || ni >= g.w - 1 || nj >= g.h - 1 {
            return 0; // would breach outer shell
        }
        if at(g, ni, nj) == T_WALL {
            continue; // still inside wall band
        }
        return if is_walkable(g, ni, nj) { d } else { 0 };
    }
    0
}

/// Smash an ordinary wall tile (i, j) to create an ad-hoc shortcut.
pub fn smash_wall_at(g: &mut Grid, i: i32, j: i32) -> bool {
    if at(g, i, j) != T_WALL {
        return false;
    }
    set_tile(g, i, j, T_FLOOR);
    set_surface(g, i, j, 0);
    true
}
