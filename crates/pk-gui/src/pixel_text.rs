//! Hard-Edged Alpha-Thresholded Canvas Pixel Text — Strips anti-aliased fringes from low-resolution text.
//!
//! PORTS: `legacy/src/pixel/pixel-text.ts`

pub const ALPHA_CUT: u8 = 96;
pub const PAD: u32 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum PixelTextAlign {
    #[default]
    Left,
    Center,
    Right,
}

/// Thresholds RGBA alpha channel so values >= 96 become solid 255 and < 96 become 0.
pub fn threshold_alpha_buffer(d: &mut [u8]) {
    for i in (3..d.len()).step_by(4) {
        d[i] = if d[i] >= ALPHA_CUT { 255 } else { 0 };
    }
}

/// Measures text width in whole pixel columns based on font size and character count.
pub fn measure_pixel_text(font_size: u32, text: &str) -> u32 {
    let char_width = font_size.max(8) * 5 / 8;
    text.chars().count() as u32 * char_width
}

/// Resolves integer horizontal anchor origin so strings never land on half-pixel boundaries.
pub fn resolve_text_origin(x: i32, width: u32, align: PixelTextAlign) -> i32 {
    match align {
        PixelTextAlign::Left => x,
        PixelTextAlign::Center => x - (width as i32 / 2),
        PixelTextAlign::Right => x - width as i32,
    }
}
