//! Palette source and palette definitions for procedural renderers.
//!
//! PORTS: `render/palette.ts`

use crate::painter::Rgba;
use std::collections::HashMap;

pub const PALETTE_SIZE: usize = 32;

pub const PALETTE_HEX: [u32; PALETTE_SIZE] = [
    // ── Stone / void (0-5) ──
    0x0b0d12, // 0  void black
    0x171a22, // 1  outline
    0x2b303b, // 2  stone dark
    0x454f5e, // 3  stone mid
    0x6b7688, // 4  stone light
    0x9aa4b4, // 5  stone highlight

    // ── Rot green (6-9) ──
    0x1e2f1f, // 6  rot shadow
    0x3d5c3a, // 7  rot dark
    0x5f8a4f, // 8  rot mid
    0x8fc46b, // 9  rot light

    // ── Blood (10-13) ──
    0x3a0f18, // 10 blood shadow
    0x6b1f2a, // 11 blood dark
    0xa83244, // 12 blood mid
    0xd95763, // 13 blood light

    // ── Torch (14-18) — the only warmth ──
    0x7a3b12, // 14 ember
    0xd97b29, // 15 flame dark
    0xf0a63c, // 16 flame
    0xffd98a, // 17 flame light
    0xfff3c8, // 18 flame core

    // ── Steel (19-22) ──
    0x544e63, // 19 steel dark (warm violet-slate)
    0x8a94a6, // 20 steel mid
    0xc8ccd4, // 21 steel light
    0xeef1f5, // 22 steel highlight

    // ── Skin (23-25) ──
    0x6b4436, // 23 skin shadow
    0xa9705a, // 24 skin mid
    0xd69f7e, // 25 skin light

    // ── Leather / wood (26-28) ──
    0x2a1c14, // 26 leather shadow
    0x4a3222, // 27 leather dark
    0x6b4a2e, // 28 leather mid

    // ── Cold accent / arcane (29-31) ──
    0x1f3d52, // 29 arcane dark
    0x2e6d8f, // 30 arcane mid
    0x6fd0e8, // 31 arcane light
];

pub fn palette_families() -> HashMap<&'static str, &'static [usize]> {
    let mut m = HashMap::new();
    m.insert("stone", &[2, 3, 4, 5][..]);
    m.insert("rot", &[6, 7, 8, 9][..]);
    m.insert("blood", &[10, 11, 12, 13][..]);
    m.insert("torch", &[14, 15, 16, 17, 18][..]);
    m.insert("steel", &[19, 20, 21, 22][..]);
    m.insert("skin", &[23, 24, 25][..]);
    m.insert("leather", &[26, 27, 28][..]);
    m.insert("arcane", &[29, 30, 31][..]);
    m
}

pub fn palette_to_float_array() -> [f32; PALETTE_SIZE * 3] {
    let mut out = [0.0f32; PALETTE_SIZE * 3];
    for (i, &hex) in PALETTE_HEX.iter().enumerate() {
        let r = ((hex >> 16) & 0xff) as f32 / 255.0;
        let g = ((hex >> 8) & 0xff) as f32 / 255.0;
        let b = (hex & 0xff) as f32 / 255.0;
        out[i * 3 + 0] = r;
        out[i * 3 + 1] = g;
        out[i * 3 + 2] = b;
    }
    out
}

pub fn palette_css(index: usize) -> String {
    let hex = PALETTE_HEX[index % PALETTE_SIZE];
    format!("#{:06x}", hex)
}

fn rgb(index: usize) -> (f64, f64, f64) {
    let hex = PALETTE_HEX[index % PALETTE_SIZE];
    (
        ((hex >> 16) & 0xff) as f64,
        ((hex >> 8) & 0xff) as f64,
        (hex & 0xff) as f64,
    )
}

fn css(r: f64, g: f64, b: f64) -> String {
    let rc = r.round().clamp(0.0, 255.0) as u8;
    let gc = g.round().clamp(0.0, 255.0) as u8;
    let bc = b.round().clamp(0.0, 255.0) as u8;
    format!("#{:02x}{:02x}{:02x}", rc, gc, bc)
}

pub fn ink_for(fill_index: usize, strength: f64) -> String {
    let (r, g, b) = rgb(fill_index);
    let k = 0.34 + 0.16 * (1.0 - strength);
    let (vr, vg, vb) = rgb(0);
    css(r * k + vr * 0.28, g * k + vg * 0.28, b * k * 0.9 + vb * 0.4)
}

pub fn highlight_for(fill_index: usize, amt: f64) -> String {
    let (r, g, b) = rgb(fill_index);
    let warm = (255.0, 236.0, 180.0);
    css(
        r + (warm.0 - r) * amt,
        g + (warm.1 - g) * amt * 0.9,
        b + (warm.2 - b) * amt * 0.7,
    )
}

pub fn shade_for(fill_index: usize, _amt: f64) -> String {
    palette_css(if fill_index > 0 { fill_index - 1 } else { 0 })
}

pub fn install_palette() {}

/// Palette index → opaque colour. The `C()` of theme.ts.
pub const fn c(i: usize) -> Rgba {
    Rgba::hex(PALETTE_HEX[i % PALETTE_SIZE])
}

/// Palette index → semi-transparent colour.
pub fn ca(i: usize, a: f32) -> Rgba {
    Rgba::hex_a(PALETTE_HEX[i % PALETTE_SIZE], (a.clamp(0.0, 1.0) * 255.0) as u8)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_theme_anchors_sit_where_the_oracle_says() {
        assert_eq!(PALETTE_HEX[16], 0xf0a63c); // gold / flame
        assert_eq!(PALETTE_HEX[13], 0xd95763); // blood light
        assert_eq!(PALETTE_HEX[31], 0x6fd0e8); // arcane light
        assert_eq!(PALETTE_HEX.len(), 32);
    }
}
