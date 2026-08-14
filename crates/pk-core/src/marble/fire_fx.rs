//! Domain-warped fractal noise fire field shader math.
//!
//! PORTS: `fx/elements/fire.ts`

use std::f64::consts::PI;

pub const FIRE_RAMP: [u8; 5] = [14, 15, 16, 17, 18];
pub const FIRE_STOPS: [f64; 4] = [0.26, 0.50, 0.74, 0.90];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FireOrientation {
    Floor,     // Radially outward advection
    Billboard, // Vertically upward advection
}

#[derive(Debug, Clone, PartialEq)]
pub struct FireSample {
    pub energy: f64,
    pub alpha: f64,
    pub palette_color_index: u8,
    pub is_core: bool,
}

/// Simple 2D hash/noise helper for procedural domain warping.
fn hash2(x: f64, z: f64) -> f64 {
    let s = (x * 12.9898 + z * 78.233).sin() * 43758.5453;
    s - s.floor()
}

fn smooth_noise(x: f64, z: f64) -> f64 {
    let ix = x.floor();
    let iz = z.floor();
    let fx = x - ix;
    let fz = z - iz;

    let ux = fx * fx * (3.0 - 2.0 * fx);
    let uz = fz * fz * (3.0 - 2.0 * fz);

    let a = hash2(ix, iz);
    let b = hash2(ix + 1.0, iz);
    let c = hash2(ix, iz + 1.0);
    let d = hash2(ix + 1.0, iz + 1.0);

    a * (1.0 - ux) * (1.0 - uz) + b * ux * (1.0 - uz) + c * (1.0 - ux) * uz + d * ux * uz
}

fn fbm(mut x: f64, mut z: f64) -> f64 {
    let mut val = 0.0;
    let mut amp = 0.5;
    for _ in 0..3 {
        val += smooth_noise(x, z) * amp;
        x *= 2.1;
        z *= 2.1;
        amp *= 0.5;
    }
    val
}

/// Samples the fire field at given coordinate, applying domain-warping, advection, and thresholded alpha.
pub fn sample_fire_surface(
    x: f64,
    z: f64,
    time: f64,
    orientation: FireOrientation,
    intensity: f64,
) -> FireSample {
    let (adv_x, adv_z) = match orientation {
        FireOrientation::Floor => {
            // Radial advection outward
            let dist = (x * x + z * z).sqrt();
            let angle = z.atan2(x);
            let radial_dist = dist - time * 0.8;
            (radial_dist * angle.cos(), radial_dist * angle.sin())
        }
        FireOrientation::Billboard => {
            // Upward vertical advection along Z
            (x, z - time * 1.6)
        }
    };

    // 1. Domain warp: sample secondary noise to perturb primary coordinate
    let warp_x = fbm(adv_x * 4.0, adv_z * 4.0 + time * 0.5);
    let warp_z = fbm(adv_x * 4.0 + 5.2, adv_z * 4.0 + 1.3);

    let sx = adv_x * 5.0 + warp_x * 1.5;
    let sz = adv_z * 5.0 + warp_z * 1.5;

    // 2. Primary fractal noise
    let raw_noise = fbm(sx, sz);

    // 3. Disc boundary attenuation
    let dist_sq = x * x + z * z;
    let mask = (1.0 - dist_sq).clamp(0.0, 1.0);

    // 4. Thresholded alpha (silhouette driven by noise, not disc)
    let energy = (raw_noise * intensity * mask).clamp(0.0, 1.0);
    let alpha = if energy > 0.15 {
        ((energy - 0.15) / 0.85).clamp(0.0, 1.0)
    } else {
        0.0
    };

    // 5. Palette band mapping using FIRE_STOPS
    let mut ramp_idx = 0;
    for (idx, &stop) in FIRE_STOPS.iter().enumerate() {
        if energy >= stop {
            ramp_idx = idx + 1;
        }
    }
    let palette_color_index = FIRE_RAMP[ramp_idx.min(FIRE_RAMP.len() - 1)];
    let is_core = energy >= FIRE_STOPS[2]; // >= 0.74 bloom threshold

    FireSample {
        energy,
        alpha,
        palette_color_index,
        is_core,
    }
}
