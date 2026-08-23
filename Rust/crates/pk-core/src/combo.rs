//! Port of `entities/combo-curve.ts` — the pure math of the pinball combo
//! ramp. Every function mirrors its TS twin line-for-line.
//!
//! ⚠️ Transcendentals go through [`crate::jsmath`], NOT `libm`. The workspace's
//! old determinism rule said `libm`, and for this file it named the wrong
//! implementation: `Math.log` in the runtime is fdlibm 5.3 while `libm::log` is
//! musl's table-driven rewrite, and they disagree across the whole `k == 0`
//! band (sqrt(2)/2 … sqrt(2)) — 2,013 inputs in 50,001, measured.
//!
//! **And on today's constants the swap changes nothing — measured, not
//! assumed.** `combo_speed_ceil` feeds `log` the values `1 + 0.15·n`, which sit
//! squarely in that band, and the raw `log` genuinely differs on 2 of the first
//! 201 combo depths. The ceiling does not: `num / den` divides the ulp away and
//! the result is bit-identical on all 201. The `exp` sites are safe for a
//! different reason — `libm::exp` already IS fdlibm, its only divergence from
//! the runtime is at `x == 1`, and these arguments are `-lambda·n <= 0`.
//!
//! So this is correct-by-construction, not a bug fixed, and no test can tell
//! the two versions apart today. It is still the right call: `bounce_combo` is
//! integral only because `comboTicks` happens to be 0/1/2 with a one-draw pick
//! and no blending, and `COMBO_CEIL_K` is a tuning constant. Either of those
//! moving would make the divergence reachable, and it would arrive as a
//! physics desync nobody would think to trace back to a logarithm.
//!
//! PORTS: `entities/combo-curve.ts`

use crate::jsmath::{js_exp, js_log};
use crate::pinball::{
    COMBO_ADD_MU, COMBO_CEIL_BASE, COMBO_CEIL_K, COMBO_CEIL_NSAT, COMBO_FRICTION_K,
    COMBO_REST_LAMBDA, COMBO_WINDOW_ALPHA, COMBO_WINDOW_MAX, COMBO_WINDOW_MIN, COMBO_ZONE_CRUISE,
    COMBO_ZONE_FRENZY, PINBALL_CORNER_ADD, PINBALL_CORNER_RESTITUTION, PINBALL_MAX_SPEED,
};
use crate::state::PLAYER_SPEED;

pub const MOMENTUM_T_FLOOR: f64 = PLAYER_SPEED;
pub const MOMENTUM_T_K: f64 = 0.22;
pub const STYLE_KILL_BASE_GOLD: i32 = 2;
pub const COMBO_GOLD_TIER: i32 = 3;
pub const COMBO_DMG_MAX: f64 = 1.35;
pub const COMBO_DMG_K: f64 = 0.15;
pub const COMBO_DMG_NSAT: f64 = 60.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ComboZone {
    Launch,
    Cruise,
    Frenzy,
}

/// Part 0 — THE MOMENTUM RAMP. How fast are you, on a 0..1 dial?
pub fn momentum_t(speed: f64) -> f64 {
    let span = PINBALL_MAX_SPEED - MOMENTUM_T_FLOOR;
    let r = speed - MOMENTUM_T_FLOOR;
    if r <= 0.0 || span <= 0.0 {
        return 0.0;
    }
    1.0f64.min((r * (1.0 + MOMENTUM_T_K)) / (r + MOMENTUM_T_K * span))
}

/// Apply a momentum-scaled multiplier: full `mult` at terminal speed, 1x at walk.
pub fn momentum_scaled(mult: f64, speed: f64) -> f64 {
    if mult == 1.0 {
        return 1.0;
    }
    1.0 + (mult - 1.0) * momentum_t(speed)
}

/// Part 1 — logarithmic ceiling on the speed a WALL/CORNER bounce can EARN.
pub fn combo_speed_ceil(n: f64) -> f64 {
    let nn = n.max(0.0);
    let num = js_log(1.0 + COMBO_CEIL_K * nn);
    let den = js_log(1.0 + COMBO_CEIL_K * COMBO_CEIL_NSAT);
    COMBO_CEIL_BASE + (PINBALL_MAX_SPEED - COMBO_CEIL_BASE) * (num / den).min(1.0)
}

/// Part 3 — corner restitution tapers from its peak toward 1.0 with depth.
pub fn combo_corner_restitution(n: f64) -> f64 {
    1.0 + (PINBALL_CORNER_RESTITUTION - 1.0) * js_exp(-COMBO_REST_LAMBDA * n.max(0.0))
}

/// Part 3 — the flat per-corner kick decays toward nothing.
pub fn combo_corner_add(n: f64) -> f64 {
    PINBALL_CORNER_ADD * js_exp(-COMBO_ADD_MU * n.max(0.0))
}

/// Part 4 — the combo window shrinks with depth then stabilises.
pub fn combo_window(n: f64) -> f64 {
    COMBO_WINDOW_MIN
        + (COMBO_WINDOW_MAX - COMBO_WINDOW_MIN) * js_exp(-COMBO_WINDOW_ALPHA * n.max(0.0))
}

/// Part 5 — global friction multiplier rising with combo: F(n) = 1 + k·√n.
pub fn combo_friction_mul(n: f64) -> f64 {
    1.0 + COMBO_FRICTION_K * n.max(0.0).sqrt()
}

/// Part 6 — tiered jackpot gold, +COMBO_GOLD_TIER per DOUBLING of the combo.
pub fn combo_kill_gold(n: f64) -> i32 {
    STYLE_KILL_BASE_GOLD + COMBO_GOLD_TIER * (n.max(1.0).log2().floor() as i32)
}

/// Part 7 — the chain's DAMAGE multiplier.
pub fn combo_damage_mult(n: f64) -> f64 {
    let over = (n - COMBO_ZONE_CRUISE).max(0.0);
    if over <= 0.0 {
        return 1.0;
    }
    let num = js_log(1.0 + COMBO_DMG_K * over);
    let den = js_log(1.0 + COMBO_DMG_K * COMBO_DMG_NSAT);
    1.0 + (COMBO_DMG_MAX - 1.0) * (num / den).min(1.0)
}

/// Part 2 — which tempo act the current combo count sits in.
pub fn combo_zone(n: f64) -> ComboZone {
    if n >= COMBO_ZONE_FRENZY {
        ComboZone::Frenzy
    } else if n >= COMBO_ZONE_CRUISE {
        ComboZone::Cruise
    } else {
        ComboZone::Launch
    }
}

/// Frenzy intensity in [0,1] for presentation FX.
pub fn frenzy_intensity(n: f64) -> f64 {
    if n < COMBO_ZONE_FRENZY {
        0.0
    } else {
        1.0f64.min((n - COMBO_ZONE_FRENZY) / COMBO_ZONE_FRENZY)
    }
}

/// Part 8 — THE ENEMY GATE, as a curve.
pub fn momentum_gate(speed: f64, gate_speed: f64, soft: f64) -> f64 {
    let t = momentum_t(speed);
    let tg = momentum_t(gate_speed);
    let s = soft.clamp(0.0, 1.0);
    if tg <= 0.0 {
        return s + (1.0 - s) * t;
    }
    if t <= 0.0 {
        return 0.0;
    }
    if t <= tg {
        return (s * t) / tg;
    }
    if tg >= 1.0 {
        return s;
    }
    s + (1.0 - s) * ((t - tg) / (1.0 - tg))
}
