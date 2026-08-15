//! Family Crossing — arithmetic model measuring how geometric lighting and ambient
//! multipliers alter a pixel's material palette family.
//!
//! PORTS: `render/light-crossing.ts`

use crate::palette::PALETTE_HEX;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PaletteFamily {
    Stone,   // 0..=5
    Rot,     // 6..=9
    Blood,   // 10..=13
    Torch,   // 14..=18
    Steel,   // 19..=22
    Skin,    // 23..=25
    Leather, // 26..=28
    Arcane,  // 29..=31
}

pub fn family_of(idx: usize) -> PaletteFamily {
    match idx {
        0..=5 => PaletteFamily::Stone,
        6..=9 => PaletteFamily::Rot,
        10..=13 => PaletteFamily::Blood,
        14..=18 => PaletteFamily::Torch,
        19..=22 => PaletteFamily::Steel,
        23..=25 => PaletteFamily::Skin,
        26..=28 => PaletteFamily::Leather,
        29..=31 => PaletteFamily::Arcane,
        _ => PaletteFamily::Stone,
    }
}

pub fn srgb_to_linear(c: f64) -> f64 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

pub fn linear_to_srgb(c: f64) -> f64 {
    if c <= 0.0031308 {
        c * 12.92
    } else {
        1.055 * c.max(0.0).powf(1.0 / 2.4) - 0.055
    }
}

pub fn hex_to_srgb(h: u32) -> [f64; 3] {
    [
        ((h >> 16) & 255) as f64 / 255.0,
        ((h >> 8) & 255) as f64 / 255.0,
        (h & 255) as f64 / 255.0,
    ]
}

pub fn hex_to_linear(h: u32) -> [f64; 3] {
    let s = hex_to_srgb(h);
    [srgb_to_linear(s[0]), srgb_to_linear(s[1]), srgb_to_linear(s[2])]
}

pub const LUMA_W: [f64; 3] = [0.3, 0.59, 0.11];

/// Weighted-Euclidean snap in sRGB space.
pub fn snap_to_palette(srgb: [f64; 3]) -> usize {
    let mut best = 0;
    let mut best_dist = f64::INFINITY;

    for (i, &h) in PALETTE_HEX.iter().enumerate() {
        let p = hex_to_srgb(h);
        let mut d = 0.0;
        for k in 0..3 {
            let v = (srgb[k] - p[k]) * LUMA_W[k];
            d += v * v;
        }
        if d < best_dist {
            best_dist = d;
            best = i;
        }
    }
    best
}

#[derive(Clone, Debug, PartialEq)]
pub struct Rig {
    pub ambient_hex: u32,
    pub ambient_intensity: f64,
    pub sky_hex: u32,
    pub ground_hex: u32,
    pub hemi_intensity: f64,
    pub dir_hex: u32,
    pub dir_intensity: f64,
    pub torch_hex: u32,
    pub torch_intensity: f64,
}

impl Default for Rig {
    fn default() -> Self {
        Self {
            ambient_hex: 0x454f5e,
            ambient_intensity: 3.5,
            sky_hex: 0x2e6d8f,
            ground_hex: 0x171a22,
            hemi_intensity: 1.2,
            dir_hex: 0xffd98a,
            dir_intensity: 2.0,
            torch_hex: 0xf0a63c,
            torch_intensity: 4.0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Situation {
    pub ndotl: f64,
    pub up: f64,
    pub torch: f64,
}

pub fn light_multiplier(rig: &Rig, s: &Situation) -> [f64; 3] {
    let amb = hex_to_linear(rig.ambient_hex);
    let sky = hex_to_linear(rig.sky_hex);
    let gnd = hex_to_linear(rig.ground_hex);
    let dir = hex_to_linear(rig.dir_hex);
    let tor = hex_to_linear(rig.torch_hex);

    let mut out = [0.0; 3];
    for k in 0..3 {
        let irradiance = amb[k] * rig.ambient_intensity
            + sky[k] * rig.hemi_intensity * s.up
            + gnd[k] * rig.hemi_intensity * (1.0 - s.up)
            + dir[k] * rig.dir_intensity * s.ndotl
            + tor[k] * rig.torch_intensity * s.torch * s.ndotl;
        out[k] = irradiance / std::f64::consts::PI;
    }
    out
}

pub fn lit_colour(albedo_idx: usize, mul: [f64; 3]) -> [f64; 3] {
    let a = hex_to_linear(PALETTE_HEX[albedo_idx]);
    [
        linear_to_srgb(a[0] * mul[0]).clamp(0.0, 1.0),
        linear_to_srgb(a[1] * mul[1]).clamp(0.0, 1.0),
        linear_to_srgb(a[2] * mul[2]).clamp(0.0, 1.0),
    ]
}

pub fn generate_situations() -> Vec<Situation> {
    let mut out = Vec::with_capacity(48);
    for &ndotl in &[0.15, 0.4, 0.7, 1.0] {
        for &up in &[0.15, 0.5, 0.85] {
            for &torch in &[0.0, 0.15, 0.4, 1.0] {
                out.push(Situation { ndotl, up, torch });
            }
        }
    }
    out
}

/// Measures the fraction of (material, situation) pairs that cross family boundaries.
pub fn crossing_rate_for_rig(rig: &Rig) -> f64 {
    let situations = generate_situations();
    let mut total = 0;
    let mut crossed = 0;

    for albedo_idx in 0..PALETTE_HEX.len() {
        let original_family = family_of(albedo_idx);
        for s in &situations {
            let mul = light_multiplier(rig, s);
            let lit = lit_colour(albedo_idx, mul);
            let snapped_idx = snap_to_palette(lit);
            let snapped_family = family_of(snapped_idx);

            total += 1;
            if original_family != snapped_family {
                crossed += 1;
            }
        }
    }

    if total == 0 {
        0.0
    } else {
        crossed as f64 / total as f64
    }
}
