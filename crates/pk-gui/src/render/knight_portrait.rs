//! Knight Portrait Paperdoll Layout — Scaled integer positioning and centering for equipment inspection mirrors.
//!
//! PORTS: `render/knight-portrait.ts`

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct KnightPortraitFit {
    pub scale: f32,
    pub width: u32,
    pub height: u32,
    pub offset_x: i32,
    pub offset_y: i32,
}

/// Calculates aspect-preserving scale and letterbox centering coordinates for rendering a knight paperdoll portrait.
pub fn compute_portrait_fit(target_w: u32, target_h: u32, sprite_px: u32) -> KnightPortraitFit {
    if target_w == 0 || target_h == 0 || sprite_px == 0 {
        return KnightPortraitFit {
            scale: 1.0,
            width: 0,
            height: 0,
            offset_x: 0,
            offset_y: 0,
        };
    }

    let scale = (target_w as f32 / sprite_px as f32).min(target_h as f32 / sprite_px as f32);
    let w = (sprite_px as f32 * scale).floor() as u32;
    let h = (sprite_px as f32 * scale).floor() as u32;
    let offset_x = (target_w as i32 - w as i32) / 2;
    let offset_y = (target_h as i32 - h as i32) / 2;

    KnightPortraitFit {
        scale,
        width: w,
        height: h,
        offset_x,
        offset_y,
    }
}
