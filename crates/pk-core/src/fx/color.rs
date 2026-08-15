//! Palette to LINEAR color converters for WebGPU buffers.
//!
//! PORTS: `fx/color.ts`

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
    // ── Torch (14-18) ──
    0x7a3b12, // 14 ember
    0xd97b29, // 15 flame dark
    0xf0a63c, // 16 flame
    0xffd98a, // 17 flame light
    0xfff3c8, // 18 flame core
    // ── Steel (19-22) ──
    0x544e63, // 19 steel dark
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

/// sRGB transfer function, inverted. The exact piecewise curve, not 2.2 approximation.
pub fn to_linear(c: f32) -> f32 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

/// sRGB hex -> linear [r, g, b] in 0.0..1.0 for the linear scene buffer.
pub fn lin_color(hex: u32) -> [f32; 3] {
    let r = ((hex >> 16) & 0xff) as f32 / 255.0;
    let g = ((hex >> 8) & 0xff) as f32 / 255.0;
    let b = (hex & 0xff) as f32 / 255.0;
    [to_linear(r), to_linear(g), to_linear(b)]
}

/// Palette INDEX -> linear [r, g, b].
pub fn pal_lin(index: usize) -> [f32; 3] {
    let hex = PALETTE_HEX
        .get(index)
        .copied()
        .unwrap_or_else(|| panic!("palLin: no palette entry {}", index));
    lin_color(hex)
}
