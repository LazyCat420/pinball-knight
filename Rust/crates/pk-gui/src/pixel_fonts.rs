//! Pixel Fonts Compatibility Barrel — Re-exports font specifications for dungeon HUD and labels.
//!
//! PORTS: `pixel-fonts.ts`

pub use crate::pixel_font::{
    PixelFontSpec, PIXEL_FONT_LABEL, PIXEL_FONT_NUM, SPEC_LABEL, SPEC_NUMERAL,
};

/// Returns the font family name for UI labels.
pub fn label_font() -> &'static str {
    PIXEL_FONT_LABEL
}

/// Returns the font family name for HUD numeric meters.
pub fn num_font() -> &'static str {
    PIXEL_FONT_NUM
}

/// Compatibility stub for font face loading.
pub fn ensure_pixel_fonts() {}
