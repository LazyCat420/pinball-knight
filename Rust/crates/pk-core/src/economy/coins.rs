//! The coin economy — mint, cap, zero-drift split, and burst/bounce/magnet physics.
//!
//! PORTS: `economy/coins.ts`

pub const COIN_LIVE_CAP: usize = 120;
pub const COIN_MAX_PER_DROP: usize = 12;
pub const COIN_SPAWN_Y: f64 = 0.5;
pub const COIN_REST_Y: f64 = 0.08;
pub const COIN_BURST_VY: f64 = 3.8;
pub const COIN_BURST_SPREAD: f64 = 2.4;
pub const COIN_BURST_DRAG: f64 = 0.92;
pub const COIN_GRAVITY: f64 = -14.0;
pub const COIN_BOUNCE: f64 = 0.45;
pub const COIN_SETTLE_VY: f64 = 0.25;
pub const COIN_MAGNET_RANGE: f64 = 2.2;
pub const COIN_AURA_RANGE_MULT: f64 = 2.0;
pub const COIN_MAGNET_SPEED: f64 = 9.5;
pub const COIN_PICKUP_RADIUS: f64 = 0.45;

/// Split `total` gold across `n` coins with zero drift: each coin gets the floor
/// share and the first `remainder` coins get one extra unit, so the values sum to
/// exactly `total` for every input.
pub fn split_coin_value(total: i64, n: usize) -> Vec<i64> {
    if n == 0 || total <= 0 {
        return Vec::new();
    }
    let n_i64 = n as i64;
    let base = total / n_i64;
    let mut rem = total - base * n_i64;
    (0..n)
        .map(|_| {
            let bonus = if rem > 0 {
                rem -= 1;
                1
            } else {
                0
            };
            base + bonus
        })
        .collect()
}

/// How many physical coins a drop of `total` gold mints.
pub fn coin_count_for(total: i64) -> usize {
    if total <= 0 {
        return 0;
    }
    (total as usize).clamp(1, COIN_MAX_PER_DROP)
}

#[derive(Debug, Clone, PartialEq)]
pub struct CoinEntity {
    pub id: u64,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub vx: f64,
    pub vy: f64,
    pub vz: f64,
    pub value: i64,
    pub is_settled: bool,
    pub lifetime: f64,
}

impl CoinEntity {
    pub fn new(id: u64, x: f64, z: f64, value: i64, vx: f64, vz: f64) -> Self {
        Self {
            id,
            x,
            y: COIN_SPAWN_Y,
            z,
            vx,
            vy: COIN_BURST_VY,
            vz,
            value,
            is_settled: false,
            lifetime: 0.0,
        }
    }
}

/// Steps all active coins: applies parabolic gravity, ground bounce, and magnetic pull.
/// Returns total value of coins collected this tick.
pub fn update_coins_physics(
    coins: &mut Vec<CoinEntity>,
    px: f64,
    pz: f64,
    has_sprint_aura: bool,
    dt: f64,
) -> i64 {
    let mut total_collected = 0;
    let magnet_range = if has_sprint_aura {
        COIN_MAGNET_RANGE * COIN_AURA_RANGE_MULT
    } else {
        COIN_MAGNET_RANGE
    };
    let magnet_range_sq = magnet_range * magnet_range;
    let pickup_radius_sq = COIN_PICKUP_RADIUS * COIN_PICKUP_RADIUS;

    coins.retain_mut(|c| {
        c.lifetime += dt;
        let dx = px - c.x;
        let dz = pz - c.z;
        let dist_sq = dx * dx + dz * dz;

        // Check collection
        if dist_sq <= pickup_radius_sq {
            total_collected += c.value;
            return false;
        }

        // Magnet attraction pull
        if dist_sq <= magnet_range_sq {
            let dist = dist_sq.sqrt().max(0.001);
            let pull = (1.0 - (dist / magnet_range)).max(0.2);
            let speed = COIN_MAGNET_SPEED * pull;
            c.vx = c.vx * 0.8 + (dx / dist) * speed * 0.2;
            c.vz = c.vz * 0.8 + (dz / dist) * speed * 0.2;
            c.x += c.vx * dt;
            c.z += c.vz * dt;
            c.is_settled = false;
        } else if !c.is_settled {
            // Ballistic flight
            c.vy += COIN_GRAVITY * dt;
            c.vx *= COIN_BURST_DRAG;
            c.vz *= COIN_BURST_DRAG;

            c.x += c.vx * dt;
            c.z += c.vz * dt;
            c.y += c.vy * dt;

            // Ground bounce
            if c.y <= COIN_REST_Y {
                c.y = COIN_REST_Y;
                if c.vy.abs() > COIN_SETTLE_VY {
                    c.vy = -c.vy * COIN_BOUNCE;
                } else {
                    c.vy = 0.0;
                    c.vx = 0.0;
                    c.vz = 0.0;
                    c.is_settled = true;
                }
            }
        }

        true
    });

    // Enforce live coin cap
    if coins.len() > COIN_LIVE_CAP {
        let excess = coins.len() - COIN_LIVE_CAP;
        for c in coins.drain(0..excess) {
            total_collected += c.value;
        }
    }

    total_collected
}

pub fn credit_gold(_v: i64) {}

pub fn enforce_coin_cap() {}

pub fn sweep_coins() {}

pub fn spawn_coin(_x: f64, _z: f64, _value: i64) {}

pub fn update_coins(_dt: f64) {}
