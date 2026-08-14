//! Procedural Water Ripple, Schlick Fresnel, and Caustics Shader Math.
//!
//! PORTS: `fx/elements/water.ts`

use std::f64::consts::PI;

/// Deep -> shallow -> foam palette indices (Arcane 29-31 plus steel highlight 22).
pub const WATER_RAMP: [u8; 5] = [1, 29, 30, 31, 22];

/// Compile-time constant surface-to-eye vector for isometric camera (yaw 45°, tilt 38°).
pub const V_EYE: (f64, f64, f64) = (0.5572, 0.6157, 0.5572);

pub const WAVE_FREQS: [f64; 3] = [14.0, 19.0, 27.0];

#[derive(Debug, Clone, PartialEq)]
pub struct WaterSample {
    pub height: f64,
    pub normal: (f64, f64, f64),
    pub fresnel: f64,
    pub caustic: f64,
    pub palette_color_index: u8,
}

/// Evaluates water surface height using three incommensurate wave packets and an optional decaying splash ring.
pub fn sample_water_height(
    x: f64,
    z: f64,
    time: f64,
    impact_x: f64,
    impact_z: f64,
    impact_time: f64,
) -> f64 {
    // 1. Summed sines with phase warping
    let p1 = (x * WAVE_FREQS[0] + time * 1.5).sin();
    let p2 = (z * WAVE_FREQS[1] - time * 1.2).sin();
    let p3 = ((x + z) * WAVE_FREQS[2] * 0.707 + time * 2.1).sin();

    let mut h = (p1 * 0.4 + p2 * 0.35 + p3 * 0.25) * 0.08;

    // 2. Splash ring impact wave
    let dt = time - impact_time;
    if dt > 0.0 && dt < 1.2 {
        let dx = x - impact_x;
        let dz = z - impact_z;
        let dist = (dx * dx + dz * dz).sqrt();
        let ring_radius = dt * 3.5;
        let ring_width = 0.35;
        let ring_dist = (dist - ring_radius).abs();

        if ring_dist < ring_width {
            let ring_phase = (ring_dist / ring_width) * PI * 0.5;
            let decay = (1.0 - dt / 1.2).max(0.0);
            h += ring_phase.cos() * 0.15 * decay;
        }
    }

    h
}

/// Samples the full water surface term including central-difference normals and Schlick Fresnel.
pub fn sample_water_surface(
    x: f64,
    z: f64,
    time: f64,
    impact_x: f64,
    impact_z: f64,
    impact_time: f64,
) -> WaterSample {
    let eps = 0.02;
    let h_center = sample_water_height(x, z, time, impact_x, impact_z, impact_time);
    let h_right = sample_water_height(x + eps, z, time, impact_x, impact_z, impact_time);
    let h_down = sample_water_height(x, z + eps, time, impact_x, impact_z, impact_time);

    // Central difference normal calculation: N = normalize(-dh/dx, 1.0, -dh/dz)
    let dh_dx = (h_right - h_center) / eps;
    let dh_dz = (h_down - h_center) / eps;

    let nx = -dh_dx;
    let ny = 1.0;
    let nz = -dh_dz;
    let n_len = (nx * nx + ny * ny + nz * nz).sqrt();
    let normal = (nx / n_len, ny / n_len, nz / n_len);

    // Schlick Fresnel against constant eye vector: F = F0 + (1 - F0) * (1 - dot(N, V))^5
    let dot_nv = (normal.0 * V_EYE.0 + normal.1 * V_EYE.1 + normal.2 * V_EYE.2).clamp(0.0, 1.0);
    let f0 = 0.02;
    let fresnel = f0 + (1.0 - f0) * (1.0 - dot_nv).powi(5);

    // Caustics estimation from dual drift
    let c1 = ((x * 8.0 + time * 0.5).sin() * (z * 8.0 + time * 0.5).cos()).abs();
    let c2 = ((x * 7.5 - time * 0.4).cos() * (z * 7.5 - time * 0.4).sin()).abs();
    let caustic = c1 * c2;

    // Palette band mapping based on height & fresnel
    let energy = (h_center * 5.0 + fresnel * 2.0).clamp(0.0, 0.999);
    let ramp_idx = (energy * WATER_RAMP.len() as f64).floor() as usize;
    let palette_color_index = WATER_RAMP[ramp_idx.min(WATER_RAMP.len() - 1)];

    WaterSample {
        height: h_center,
        normal,
        fresnel,
        caustic,
        palette_color_index,
    }
}
