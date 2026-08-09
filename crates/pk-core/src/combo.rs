//! Port of `entities/combo-curve.ts` — the pure math of the pinball combo
//! ramp. Every function mirrors its TS twin line-for-line; transcendentals go
//! through `libm` (the determinism commandment).

use crate::pinball::{
    COMBO_ADD_MU, COMBO_CEIL_BASE, COMBO_CEIL_K, COMBO_CEIL_NSAT, COMBO_FRICTION_K,
    COMBO_REST_LAMBDA, COMBO_WINDOW_ALPHA, COMBO_WINDOW_MAX, COMBO_WINDOW_MIN, COMBO_ZONE_CRUISE,
    COMBO_ZONE_FRENZY, PINBALL_CORNER_ADD, PINBALL_CORNER_RESTITUTION, PINBALL_MAX_SPEED,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ComboZone {
    Launch,
    Cruise,
    Frenzy,
}

/// Part 1 — logarithmic ceiling on the speed a WALL/CORNER bounce can EARN.
pub fn combo_speed_ceil(n: f64) -> f64 {
    let nn = n.max(0.0);
    let num = libm::log(1.0 + COMBO_CEIL_K * nn);
    let den = libm::log(1.0 + COMBO_CEIL_K * COMBO_CEIL_NSAT);
    COMBO_CEIL_BASE + (PINBALL_MAX_SPEED - COMBO_CEIL_BASE) * (num / den).min(1.0)
}

/// Part 3 — corner restitution tapers from its peak toward 1.0 with depth.
pub fn combo_corner_restitution(n: f64) -> f64 {
    1.0 + (PINBALL_CORNER_RESTITUTION - 1.0) * libm::exp(-COMBO_REST_LAMBDA * n.max(0.0))
}

/// Part 3 — the flat per-corner kick decays toward nothing.
pub fn combo_corner_add(n: f64) -> f64 {
    PINBALL_CORNER_ADD * libm::exp(-COMBO_ADD_MU * n.max(0.0))
}

/// Part 4 — the combo window shrinks with depth then stabilises.
pub fn combo_window(n: f64) -> f64 {
    COMBO_WINDOW_MIN
        + (COMBO_WINDOW_MAX - COMBO_WINDOW_MIN) * libm::exp(-COMBO_WINDOW_ALPHA * n.max(0.0))
}

/// Part 5 — global friction multiplier rising with combo: F(n) = 1 + k·√n.
pub fn combo_friction_mul(n: f64) -> f64 {
    1.0 + COMBO_FRICTION_K * n.max(0.0).sqrt()
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
