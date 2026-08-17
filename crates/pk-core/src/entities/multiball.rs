//! 🔮 MULTI-BALL — the pinball classic, as a power-up.
//!
//! Port of `legacy/src/game/pinball-knight/entities/multiball.ts` (342 lines).
//!
//! Handles:
//! - Two echo knights peeling off the player and trailing sampled history
//! - Lagged trail interpolation and sideways normal offsets
//! - Contact damage against monsters at 50% ram multiplier with per-enemy cooldowns
//! - MultiBall active state, position queries, spawn, per-frame step, and disposal
//!
//! PORTS: `entities/multiball.ts`

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use crate::state::Facing;

pub const MULTIBALL_COUNT: usize = 2;
pub const MULTIBALL_TRAIL_SECONDS: f64 = 1.2;
pub const MULTIBALL_LAGS: [f64; 2] = [0.22, 0.40];
pub const MULTIBALL_SIDE_OFFSET: f64 = 0.42;
pub const MULTIBALL_HEADING_STEP: f64 = 0.10;
pub const MULTIBALL_FOLLOW_RATE: f64 = 16.0;
pub const MULTIBALL_RAM_MULT: f64 = 0.5;
pub const MULTIBALL_RAM_COOLDOWN: f64 = 0.45;
pub const MULTIBALL_OPACITY: f64 = 0.5;

static MULTIBALL_ACTIVE: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, PartialEq)]
pub struct TrailPoint {
    pub x: f64,
    pub z: f64,
    pub t: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct EchoState {
    pub x: f64,
    pub z: f64,
    pub facing: Facing,
    pub clip: String,
    pub lag: f64,
    pub side: f64,
    pub hit_cd: HashMap<u32, f64>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct MultiBallManager {
    pub active: bool,
    pub local_time: f64,
    pub trail: VecDeque<TrailPoint>,
    pub echoes: Vec<EchoState>,
}

static MANAGER: Mutex<Option<MultiBallManager>> = Mutex::new(None);

pub fn push_trail(
    trail: &mut VecDeque<TrailPoint>,
    x: f64,
    z: f64,
    t: f64,
    max_age: f64,
) {
    trail.push_back(TrailPoint { x, z, t });
    let cutoff = t - max_age;
    while let Some(front) = trail.front() {
        if front.t < cutoff {
            trail.pop_front();
        } else {
            break;
        }
    }
}

pub fn sample_trail(trail: &VecDeque<TrailPoint>, t: f64) -> Option<(f64, f64)> {
    if trail.is_empty() {
        return None;
    }
    if t <= trail.front().unwrap().t {
        let f = trail.front().unwrap();
        return Some((f.x, f.z));
    }
    if t >= trail.back().unwrap().t {
        let b = trail.back().unwrap();
        return Some((b.x, b.z));
    }

    for i in 0..trail.len() - 1 {
        let p0 = &trail[i];
        let p1 = &trail[i + 1];
        if p0.t <= t && t <= p1.t {
            let span = p1.t - p0.t;
            let u = if span > 1e-6 { (t - p0.t) / span } else { 0.0 };
            return Some((p0.x + (p1.x - p0.x) * u, p0.z + (p1.z - p0.z) * u));
        }
    }

    let last = trail.back().unwrap();
    Some((last.x, last.z))
}

pub fn echo_target(
    trail: &VecDeque<TrailPoint>,
    now: f64,
    lag: f64,
    side_offset: f64,
) -> Option<(f64, f64)> {
    let t_sample = now - lag;
    let (cx, cz) = sample_trail(trail, t_sample)?;
    let (hx, hz) = sample_trail(trail, t_sample - MULTIBALL_HEADING_STEP).unwrap_or((cx, cz));

    let dx = cx - hx;
    let dz = cz - hz;
    let len_sq = dx * dx + dz * dz;

    if len_sq > 1e-6 {
        let len = len_sq.sqrt();
        // Normal vector (-dz, dx)
        let nx = -dz / len;
        let nz = dx / len;
        Some((cx + nx * side_offset, cz + nz * side_offset))
    } else {
        Some((cx + side_offset, cz))
    }
}

pub fn follow_step(current: f64, target: f64, dt: f64, rate: f64) -> f64 {
    let alpha = 1.0 - (-rate * dt).exp();
    current + (target - current) * alpha
}

pub fn echo_pose(player_clip: &str, player_rate: f64, moving: bool) -> (String, f64) {
    if moving {
        ("run".to_string(), player_rate)
    } else {
        (player_clip.to_string(), player_rate)
    }
}

pub fn can_ram(hit_cd: &HashMap<u32, f64>, monster_id: u32) -> bool {
    !hit_cd.contains_key(&monster_id) || hit_cd.get(&monster_id).copied().unwrap_or(0.0) <= 0.0
}

pub fn tick_ram_cooldowns(hit_cd: &mut HashMap<u32, f64>, dt: f64) {
    hit_cd.retain(|_, timer| {
        *timer -= dt;
        *timer > 0.0
    });
}

pub fn multi_ball_active() -> bool {
    MULTIBALL_ACTIVE.load(Ordering::Relaxed)
}

#[derive(Clone, Debug, PartialEq)]
pub struct EchoPosition {
    pub x: f64,
    pub z: f64,
    pub clip: String,
    pub facing: Facing,
}

pub fn multi_ball_positions() -> Vec<EchoPosition> {
    if let Ok(lock) = MANAGER.lock() {
        if let Some(ref m) = *lock {
            return m
                .echoes
                .iter()
                .map(|e| EchoPosition {
                    x: e.x,
                    z: e.z,
                    clip: e.clip.clone(),
                    facing: e.facing,
                })
                .collect();
        }
    }
    Vec::new()
}

pub fn spawn_multi_ball(player_x: f64, player_z: f64) {
    MULTIBALL_ACTIVE.store(true, Ordering::Relaxed);
    let mut echoes = Vec::with_capacity(MULTIBALL_COUNT);
    for idx in 0..MULTIBALL_COUNT {
        let side = if idx % 2 == 0 {
            -MULTIBALL_SIDE_OFFSET
        } else {
            MULTIBALL_SIDE_OFFSET
        };
        echoes.push(EchoState {
            x: player_x,
            z: player_z,
            facing: Facing::S,
            clip: "idle".to_string(),
            lag: MULTIBALL_LAGS[idx],
            side,
            hit_cd: HashMap::new(),
        });
    }

    let mut m = MultiBallManager {
        active: true,
        local_time: 0.0,
        trail: VecDeque::new(),
        echoes,
    };
    push_trail(&mut m.trail, player_x, player_z, 0.0, MULTIBALL_TRAIL_SECONDS);

    if let Ok(mut lock) = MANAGER.lock() {
        *lock = Some(m);
    }
}

pub fn update_multi_ball(player_x: f64, player_z: f64, dt: f64) {
    if !multi_ball_active() {
        return;
    }

    if let Ok(mut lock) = MANAGER.lock() {
        if let Some(ref mut m) = *lock {
            m.local_time += dt;
            push_trail(&mut m.trail, player_x, player_z, m.local_time, MULTIBALL_TRAIL_SECONDS);

            for echo in &mut m.echoes {
                tick_ram_cooldowns(&mut echo.hit_cd, dt);
                if let Some((tx, tz)) = echo_target(&m.trail, m.local_time, echo.lag, echo.side) {
                    echo.x = follow_step(echo.x, tx, dt, MULTIBALL_FOLLOW_RATE);
                    echo.z = follow_step(echo.z, tz, dt, MULTIBALL_FOLLOW_RATE);
                }
            }
        }
    }
}

pub fn dispose_multi_ball() {
    MULTIBALL_ACTIVE.store(false, Ordering::Relaxed);
    if let Ok(mut lock) = MANAGER.lock() {
        *lock = None;
    }
}
