//! The Cold Crypt palette — `legacy/src/game/pinball-knight/render/palette.ts`.
//!
//! 32 entries, transcribed verbatim. The GUI names entries by INDEX (see
//! `theme`), because the legacy UI composites before a (now default-off)
//! palette snap and picking off-palette colours meant the shader silently
//! decided what the UI looked like.

use crate::painter::Rgba;

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

/// Palette index → opaque colour. The `C()` of theme.ts.
pub const fn c(i: usize) -> Rgba {
    Rgba::hex(PALETTE_HEX[i])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_theme_anchors_sit_where_the_oracle_says() {
        // The three colours theme.ts calls out as pre-existing palette entries.
        assert_eq!(PALETTE_HEX[16], 0xf0a63c); // gold / flame
        assert_eq!(PALETTE_HEX[13], 0xd95763); // blood light
        assert_eq!(PALETTE_HEX[31], 0x6fd0e8); // arcane light
        assert_eq!(PALETTE_HEX.len(), 32);
    }
}
