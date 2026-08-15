//! Elemental Procedural Noise Building Blocks — Shared TSL math, coordinate mapping, and band quantization.
//!
//! PORTS: `fx/elements/noise.ts`

/// Maps CircleGeometry UV [0, 1]^2 to centered disc-local coordinates [-1, 1]^2.
pub fn disc_p(u: f64, v: f64) -> (f64, f64) {
    (u * 2.0 - 1.0, v * 2.0 - 1.0)
}

/// Smooth radial falloff mask for circular fluid/fire decals.
pub fn disc_mask(u: f64, v: f64, inner_radius: f64, outer_radius: f64) -> f64 {
    let (px, py) = disc_p(u, v);
    let r = (px * px + py * py).sqrt();
    if r >= outer_radius {
        0.0
    } else if r <= inner_radius {
        1.0
    } else {
        let t = (r - inner_radius) / (outer_radius - inner_radius);
        1.0 - (t * t * (3.0 - 2.0 * t))
    }
}

/// Fractional Brownian Motion 2D noise generator in [0, 1].
pub fn fbm01(u: f64, v: f64, octaves: usize) -> f64 {
    let mut value = 0.0;
    let mut amp = 0.5;
    let mut freq = 1.0;
    let mut max_amp = 0.0;

    for _ in 0..octaves {
        let n = ((u * freq).sin() * (v * freq).cos() + 1.0) * 0.5;
        value += n * amp;
        max_amp += amp;
        amp *= 0.5;
        freq *= 2.0;
    }

    (value / max_amp).clamp(0.0, 1.0)
}

/// Domain warping perturbation.
pub fn warp(u: f64, v: f64, amp: f64) -> (f64, f64) {
    let dx = (v * 4.0).sin() * amp;
    let dy = (u * 4.0).cos() * amp;
    (u + dx, v + dy)
}

/// Quantizes continuous scalar intensities into palette entry indices along authored threshold stops.
pub fn band_ramp(value: f64, stops: &[f64], ramp: &[u8]) -> u8 {
    if ramp.is_empty() {
        return 0;
    }
    for (i, &stop) in stops.iter().enumerate() {
        if value < stop {
            return ramp[i.min(ramp.len() - 1)];
        }
    }
    ramp[ramp.len() - 1]
}
