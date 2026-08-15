//! Self-Hosted Embedded Pixel Fonts — Press Start 2P (labels) and VT323 (HUD numbers).
//!
//! PORTS: `legacy/src/pixel/pixel-font.ts`

pub const PIXEL_FONT_LABEL: &str = "'Press Start 2P'";
pub const PIXEL_FONT_NUM: &str = "VT323";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PixelFontSpec {
    pub family: &'static str,
    pub is_numeral: bool,
    pub cell_step_px: u32,
}

pub const SPEC_LABEL: PixelFontSpec = PixelFontSpec {
    family: PIXEL_FONT_LABEL,
    is_numeral: false,
    cell_step_px: 8,
};

pub const SPEC_NUMERAL: PixelFontSpec = PixelFontSpec {
    family: PIXEL_FONT_NUM,
    is_numeral: true,
    cell_step_px: 16,
};
