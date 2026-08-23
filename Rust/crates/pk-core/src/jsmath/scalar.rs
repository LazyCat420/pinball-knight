//! Scalar Math Helpers — Clamping, linear interpolation, and inverse linear interpolation.
//!
//! PORTS: `legacy/src/utils/math.ts`

/// Constrain `value` to the inclusive range [min, max].
#[inline]
pub fn clamp(value: f64, min: f64, max: f64) -> f64 {
    value.clamp(min, max)
}

/// Constrain `value` to [0, 1] — the common case for ratios, alphas and mix factors.
#[inline]
pub fn clamp01(value: f64) -> f64 {
    clamp(value, 0.0, 1.0)
}

/// Linear interpolation from `a` to `b` at position `t`. Unclamped for spring overshoot.
#[inline]
pub fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

/// Inverse of lerp — where `value` sits between `a` and `b`, as a 0..1 ratio.
/// Returns 0 for a degenerate range rather than dividing by zero.
#[inline]
pub fn inv_lerp(a: f64, b: f64, value: f64) -> f64 {
    if a == b {
        0.0
    } else {
        (value - a) / (b - a)
    }
}

/// Single-precision clamp.
#[inline]
pub fn clamp_f32(value: f32, min: f32, max: f32) -> f32 {
    value.clamp(min, max)
}

/// Single-precision clamp01.
#[inline]
pub fn clamp01_f32(value: f32) -> f32 {
    clamp_f32(value, 0.0, 1.0)
}

/// Single-precision lerp.
#[inline]
pub fn lerp_f32(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

/// Single-precision inv_lerp.
#[inline]
pub fn inv_lerp_f32(a: f32, b: f32, value: f32) -> f32 {
    if a == b {
        0.0
    } else {
        (value - a) / (b - a)
    }
}
