//! Multiball power-up — trailing echo knights with lagged trail sampling and contact damage.
//!
//! PORTS-PARTIAL: `entities/multiball.ts` - NOT a finished port - 1 of 12 exported names carried over (8%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

use crate::monsters::types::{EnemyMode, LiveMonster};
use std::collections::{HashMap, VecDeque};

pub const MULTIBALL_COUNT: usize = 2;
pub const MULTIBALL_TRAIL_SECONDS: f64 = 1.0;
pub const MULTIBALL_LAGS: [f64; 2] = [0.15, 0.30];
pub const MULTIBALL_SIDE_OFFSET: f64 = 0.45;
pub const MULTIBALL_RAM_MULT: f64 = 0.5;
pub const MULTIBALL_RAM_COOLDOWN: f64 = 0.4;
pub const MULTIBALL_HIT_RADIUS: f64 = 0.65;

#[derive(Debug, Clone, PartialEq)]
pub struct TrailPoint {
    pub x: f64,
    pub z: f64,
    pub t: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct EchoKnight {
    pub x: f64,
    pub z: f64,
    pub lag: f64,
    pub side: f64,
    pub hit_cds: HashMap<u32, f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MultiballHit {
    pub echo_idx: usize,
    pub monster_id: u32,
    pub damage: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MultiballState {
    pub active: bool,
    pub timer: f64,
    pub trail: VecDeque<TrailPoint>,
    pub echoes: Vec<EchoKnight>,
}

impl Default for MultiballState {
    fn default() -> Self {
        Self {
            active: false,
            timer: 0.0,
            trail: VecDeque::new(),
            echoes: vec![
                EchoKnight {
                    x: 0.0,
                    z: 0.0,
                    lag: MULTIBALL_LAGS[0],
                    side: -MULTIBALL_SIDE_OFFSET,
                    hit_cds: HashMap::new(),
                },
                EchoKnight {
                    x: 0.0,
                    z: 0.0,
                    lag: MULTIBALL_LAGS[1],
                    side: MULTIBALL_SIDE_OFFSET,
                    hit_cds: HashMap::new(),
                },
            ],
        }
    }
}

/// Samples interpolated position along the player position trail at a given timestamp.
fn sample_trail(trail: &VecDeque<TrailPoint>, target_t: f64) -> (f64, f64, f64, f64) {
    if trail.is_empty() {
        return (0.0, 0.0, 0.0, 1.0);
    }
    if trail.len() == 1 || target_t <= trail.front().unwrap().t {
        let f = trail.front().unwrap();
        return (f.x, f.z, 0.0, 1.0);
    }
    if target_t >= trail.back().unwrap().t {
        let b = trail.back().unwrap();
        return (b.x, b.z, 0.0, 1.0);
    }

    for i in 0..trail.len() - 1 {
        let p0 = &trail[i];
        let p1 = &trail[i + 1];
        if p0.t <= target_t && target_t <= p1.t {
            let dt = (p1.t - p0.t).max(0.0001);
            let alpha = (target_t - p0.t) / dt;
            let x = p0.x + alpha * (p1.x - p0.x);
            let z = p0.z + alpha * (p1.z - p0.z);
            let dx = p1.x - p0.x;
            let dz = p1.z - p0.z;
            let len = (dx * dx + dz * dz).sqrt().max(0.001);
            return (x, z, dx / len, dz / len);
        }
    }

    let b = trail.back().unwrap();
    (b.x, b.z, 0.0, 1.0)
}

/// Advances multiball trail physics and checks contact damage against monsters.
pub fn step_multiball(
    state: &mut MultiballState,
    player_x: f64,
    player_z: f64,
    monsters: &mut [LiveMonster],
    player_ram_dmg: f64,
    dt: f64,
) -> Vec<MultiballHit> {
    if !state.active {
        return Vec::new();
    }

    state.timer += dt;
    state.trail.push_back(TrailPoint {
        x: player_x,
        z: player_z,
        t: state.timer,
    });

    // Prune stale trail points
    let min_t = state.timer - MULTIBALL_TRAIL_SECONDS;
    while state.trail.len() > 2 && state.trail.front().unwrap().t < min_t {
        state.trail.pop_front();
    }

    let mut hits = Vec::new();

    for (echo_idx, echo) in state.echoes.iter_mut().enumerate() {
        // Cooldown tick
        for cd in echo.hit_cds.values_mut() {
            *cd = (*cd - dt).max(0.0);
        }

        let target_t = state.timer - echo.lag;
        let (sx, sz, fwd_x, fwd_z) = sample_trail(&state.trail, target_t);

        // Perpendicular offset: (-fwd_z, fwd_x) * side
        let perp_x = -fwd_z * echo.side;
        let perp_z = fwd_x * echo.side;

        echo.x = sx + perp_x;
        echo.z = sz + perp_z;

        // Check monster hits
        for m in monsters.iter_mut() {
            if !m.is_alive() {
                continue;
            }

            let dx = echo.x - m.x;
            let dz = echo.z - m.z;
            let dist = (dx * dx + dz * dz).sqrt();

            if dist <= MULTIBALL_HIT_RADIUS {
                let can_hit = match echo.hit_cds.get(&m.id) {
                    Some(&cd) => cd <= 0.0,
                    None => true,
                };

                if can_hit {
                    let dmg = player_ram_dmg * MULTIBALL_RAM_MULT;
                    m.hp -= dmg;
                    if m.hp <= 0.0 {
                        m.mode = EnemyMode::Dead;
                    }
                    echo.hit_cds.insert(m.id, MULTIBALL_RAM_COOLDOWN);
                    hits.push(MultiballHit {
                        echo_idx,
                        monster_id: m.id,
                        damage: dmg,
                    });
                }
            }
        }
    }

    hits
}
