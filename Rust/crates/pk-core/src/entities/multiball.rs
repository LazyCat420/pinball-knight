//! 🔮 MULTI-BALL — the pinball classic, as a power-up.
//!
//! Two ECHO KNIGHTS peel off the player and chase the path you just took: each
//! samples the player's recent position TRAIL at its own lag and sits a little
//! off to one side.
//!
//! Port of `legacy/src/game/pinball-knight/entities/multiball.ts` (342 lines).
//!
//! PORTS: `entities/multiball.ts`

use std::collections::HashMap;

pub const MULTIBALL_COUNT: usize = 2;
pub const MULTIBALL_TRAIL_SECONDS: f64 = 1.2;
pub const MULTIBALL_LAGS: [f64; 2] = [0.22, 0.4];
pub const MULTIBALL_SIDE_OFFSET: f64 = 0.42;
pub const MULTIBALL_HEADING_STEP: f64 = 0.1;
pub const MULTIBALL_FOLLOW_RATE: f64 = 16.0;
pub const MULTIBALL_RAM_MULT: f64 = 0.5;
pub const MULTIBALL_RAM_COOLDOWN: f64 = 0.28;
pub const MULTIBALL_OPACITY: f64 = 0.72;

/// One sample of where the knight was, and when.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TrailPoint {
    pub x: f64,
    pub z: f64,
    /// Seconds on the buff-local clock.
    pub t: f64,
}

#[derive(Clone, Debug)]
pub struct MultiballEcho {
    pub x: f64,
    pub z: f64,
    pub lag: f64,
    pub side: f64,
    pub hit_cd: HashMap<usize, f64>,
}

impl MultiballEcho {
    pub fn new(lag: f64, side: f64, start_x: f64, start_z: f64) -> Self {
        Self {
            x: start_x,
            z: start_z,
            lag,
            side,
            hit_cd: HashMap::new(),
        }
    }
}

/// Append a sample and drop everything older than `max_age`.
pub fn push_trail(
    points: &mut Vec<TrailPoint>,
    x: f64,
    z: f64,
    t: f64,
    max_age: f64,
) -> &mut Vec<TrailPoint> {
    points.push(TrailPoint { x, z, t });
    let cutoff = t - max_age;
    while points.len() > 2 && points[1].t <= cutoff {
        points.remove(0);
    }
    points
}

/// Where the knight was at time `t`, linearly interpolated between samples.
pub fn sample_trail(points: &[TrailPoint], t: f64) -> Option<(f64, f64)> {
    if points.is_empty() {
        return None;
    }
    let first = points[0];
    let last = points[points.len() - 1];
    if t <= first.t {
        return Some((first.x, first.z));
    }
    if t >= last.t {
        return Some((last.x, last.z));
    }
    for i in (1..points.len()).rev() {
        let b = points[i];
        let a = points[i - 1];
        if t >= a.t {
            let span = b.t - a.t;
            let f = if span > 0.0 { (t - a.t) / span } else { 0.0 };
            return Some((a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f));
        }
    }
    Some((first.x, first.z))
}

/// The point an echo wants to be at.
pub fn echo_target(
    points: &[TrailPoint],
    now: f64,
    lag: f64,
    side: f64,
    heading_step: f64,
) -> Option<(f64, f64)> {
    let at = sample_trail(points, now - lag)?;
    let before = sample_trail(points, now - lag - heading_step)?;
    let dx = at.0 - before.0;
    let dz = at.1 - before.1;
    let len = (dx * dx + dz * dz).sqrt();
    if len < 1e-4 {
        return Some(at);
    }
    Some((at.0 + (-dz / len) * side, at.1 + (dx / len) * side))
}

/// Frame-rate independent exponential ease toward a target.
pub fn follow_step(current: f64, target: f64, dt: f64, rate: f64) -> f64 {
    let f = 1.0 - (-rate * dt).exp();
    current + (target - current) * f
}

/// Has this echo's cooldown on that enemy expired (or never started)?
pub fn can_ram(cd: &HashMap<usize, f64>, enemy_id: usize) -> bool {
    cd.get(&enemy_id).copied().unwrap_or(0.0) <= 0.0
}

/// Bleed every cooldown down by dt, dropping entries that reach zero.
pub fn tick_ram_cooldowns(cd: &mut HashMap<usize, f64>, dt: f64) {
    cd.retain(|_, left| {
        *left -= dt;
        *left > 0.0
    });
}

/// Spawn multiball echoes.
pub fn spawn_multiball(player_x: f64, player_z: f64) -> Vec<MultiballEcho> {
    vec![
        MultiballEcho::new(MULTIBALL_LAGS[0], MULTIBALL_SIDE_OFFSET, player_x, player_z),
        MultiballEcho::new(MULTIBALL_LAGS[1], -MULTIBALL_SIDE_OFFSET, player_x, player_z),
    ]
}

/// Update multiball echoes for one simulation step.
pub fn update_multiball(
    echoes: &mut [MultiballEcho],
    trail: &mut Vec<TrailPoint>,
    clock: &mut f64,
    player_x: f64,
    player_z: f64,
    dt: f64,
) {
    *clock += dt;
    push_trail(trail, player_x, player_z, *clock, MULTIBALL_TRAIL_SECONDS);

    for echo in echoes.iter_mut() {
        tick_ram_cooldowns(&mut echo.hit_cd, dt);
        if let Some(target) = echo_target(trail, *clock, echo.lag, echo.side, MULTIBALL_HEADING_STEP) {
            echo.x = follow_step(echo.x, target.0, dt, MULTIBALL_FOLLOW_RATE);
            echo.z = follow_step(echo.z, target.1, dt, MULTIBALL_FOLLOW_RATE);
        }
    }
}

/// Dispose multiball state.
pub fn dispose_multiball(echoes: &mut Vec<MultiballEcho>, trail: &mut Vec<TrailPoint>, clock: &mut f64) {
    echoes.clear();
    trail.clear();
    *clock = 0.0;
}
