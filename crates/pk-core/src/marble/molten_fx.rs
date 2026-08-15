//! Molten — The scar a lava marble leaves in the stone floor it rolls over.
//!
//! PORTS: `fx/elements/molten.ts`

pub const MELT_CHAR_RAMP: [u8; 4] = [0, 1, 26, 27];
pub const MELT_CHAR_STOPS: [f64; 3] = [0.30, 0.58, 0.82];

pub const MELT_SEAM_RAMP: [u8; 4] = [14, 16, 17, 18];
pub const MELT_SEAM_STOPS: [f64; 3] = [0.34, 0.62, 0.86];

pub const MELT_COOL_SECONDS: f64 = 3.5;
pub const MELT_LIFETIME_SECONDS: f64 = 5.0;

/// Smoothstep Hermite interpolation in [0, 1].
pub fn smoothstep(edge0: f64, edge1: f64, x: f64) -> f64 {
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// 2D cellular distance to nearest cell feature point (Worley noise).
pub fn worley01(u: f64, v: f64) -> f64 {
    let ui = u.floor() as i64;
    let vi = v.floor() as i64;
    let uf = u - u.floor();
    let vf = v - v.floor();

    let mut min_dist_sq = 100.0;

    for dy in -1..=1 {
        for dx in -1..=1 {
            let cx = dx as f64;
            let cy = dy as f64;

            // Simple pseudo-random hash for cell feature point offset
            let seed = (ui + dx as i64)
                .wrapping_mul(374761393)
                .wrapping_add((vi + dy as i64).wrapping_mul(668265263));
            let h1 = ((seed ^ (seed >> 13)).wrapping_mul(1274126177) & 0xffff) as f64 / 65535.0;
            let h2 = (((seed + 1) ^ ((seed + 1) >> 13)).wrapping_mul(1274126177) & 0xffff) as f64
                / 65535.0;

            let px = cx + h1;
            let py = cy + h2;

            let d_sq = (uf - px) * (uf - px) + (vf - py) * (vf - py);
            if d_sq < min_dist_sq {
                min_dist_sq = d_sq;
            }
        }
    }

    min_dist_sq.sqrt().clamp(0.0, 1.0)
}

/// Evaluates a multi-stop color band index based on scalar intensity value.
pub fn sample_band(v: f64, stops: &[f64; 3], ramp: &[u8; 4]) -> u8 {
    if v < stops[0] {
        ramp[0]
    } else if v < stops[1] {
        ramp[1]
    } else if v < stops[2] {
        ramp[2]
    } else {
        ramp[3]
    }
}

/// Samples the molten lava scar floor decal at normalized local UV coords (centered at 0,0).
/// Returns `(palette_index, alpha)`.
pub fn sample_molten_scar(u: f64, v: f64, age: f64) -> (u8, f64) {
    let r_sq = u * u + v * v;
    if r_sq > 1.0 || age >= MELT_LIFETIME_SECONDS {
        return (0, 0.0);
    }

    let disc_mask = 1.0 - smoothstep(0.7, 1.0, r_sq.sqrt());
    let cooling_factor = (1.0 - (age / MELT_COOL_SECONDS).clamp(0.0, 1.0)).powi(2);
    let overall_alpha = (1.0 - (age / MELT_LIFETIME_SECONDS).clamp(0.0, 1.0)) * disc_mask;

    // Scale coordinates for cellular crack field
    let cell_dist = worley01(u * 4.0, v * 4.0);

    // Fissures are thin ridges where cell boundary approaches max distance
    let fissure_intensity = smoothstep(0.45, 0.65, cell_dist) * cooling_factor;

    let palette_idx = if fissure_intensity > 0.3 {
        // Glowing hot magma fissure
        sample_band(fissure_intensity, &MELT_SEAM_STOPS, &MELT_SEAM_RAMP)
    } else {
        // Cooling solid rock crust plate
        let plate_heat = (1.0 - cell_dist) * cooling_factor;
        sample_band(plate_heat, &MELT_CHAR_STOPS, &MELT_CHAR_RAMP)
    };

    (palette_idx, overall_alpha)
}
