//! 🎨 RENDER CONSTANTS — Resolution, PPU zoom ladder, isometric camera, cel grading, lighting and FPS rates.
//!
//! PORTS: `constants/render.ts`

pub const RENDER_W: u32 = 1280;
pub const RENDER_H: u32 = 720;
pub const MAX_RENDER_W: u32 = 2160;
pub const MAX_RENDER_H: u32 = 1216;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CameraZoom {
    Close,
    Normal,
    Wide,
    #[default]
    Wider,
    Widest,
}

impl CameraZoom {
    pub const fn ppu(self) -> u32 {
        match self {
            Self::Close => 80,
            Self::Normal => 72,
            Self::Wide => 64,
            Self::Wider => 56,
            Self::Widest => 48,
        }
    }

    pub const fn label(self) -> &'static str {
        match self {
            Self::Close => "close",
            Self::Normal => "normal",
            Self::Wide => "wide",
            Self::Wider => "wider",
            Self::Widest => "widest",
        }
    }
}

pub const CAMERA_ZOOM_DEFAULT: CameraZoom = CameraZoom::Wider;
pub const PPU_DEFAULT: u32 = CAMERA_ZOOM_DEFAULT.ppu();

pub const VIEW_W_DEFAULT: f64 = (RENDER_W as f64) / (PPU_DEFAULT as f64);
pub const VIEW_H_DEFAULT: f64 = (RENDER_H as f64) / (PPU_DEFAULT as f64);

// ── Camera ──
pub const CAMERA_TILT: f64 = (38.0 * std::f64::consts::PI) / 180.0;
pub const CAMERA_YAW: f64 = (45.0 * std::f64::consts::PI) / 180.0;
pub const CAMERA_DIST: f64 = 24.0;

// ── Sprites ──
pub const ART_PX: u32 = 128;
pub const fn sprite_px(ppu: u32) -> u32 {
    ppu * 3
}
pub const fn sprite_pixel_grid(ppu: u32) -> u32 {
    (ppu * 3) / 2
}
pub const fn sprite_units(ppu: u32) -> f64 {
    (sprite_pixel_grid(ppu) as f64) / (ppu as f64)
}

pub const SPRITE_PX_DEFAULT: u32 = sprite_px(PPU_DEFAULT);
pub const SPRITE_PIXEL_GRID_DEFAULT: u32 = sprite_pixel_grid(PPU_DEFAULT);
pub const SPRITE_UNITS: f64 = 1.5; // 3/2 exact

// ── Style & Cel Shading ──
pub const QUANTIZE_DEFAULT: bool = false;
pub const DITHER_DEFAULT: bool = false;
pub const SCANLINE_DEFAULT: bool = false;
pub const OUTLINE_DEFAULT: bool = false;

pub const CEL_DEFAULT: bool = true;
pub const CEL_STEPS: u32 = 10;
pub const CEL_CURVE: f64 = 0.5;
pub const CEL_SATURATION: f64 = 1.15;
pub const OUTLINE_EDGE_THRESHOLD: f64 = 0.4;

// ── Lighting & Atmosphere ──
pub const AMBIENT_INTENSITY: f64 = 3.5;
pub const HEMI_INTENSITY: f64 = 1.1;
pub const DIR_INTENSITY: f64 = 1.5;
pub const PLAYER_LAMP_INTENSITY: f64 = 1.6;
pub const PLAYER_LAMP_RANGE: f64 = 4.5;
pub const DIR_HEIGHT: f64 = 14.0;
pub const SHADOW_MAP_SIZE: u32 = 1024;
pub const SHADOW_AREA: f64 = 16.0;
pub const SHADOW_OPACITY: f64 = 0.42;

pub const FOG_NEAR: f64 = 30.0;
pub const FOG_FAR: f64 = 58.0;

pub const BLOOM_THRESHOLD: f64 = 0.7;
pub const BLOOM_STRENGTH: f64 = 0.9;
pub const BLOOM_RADIUS: f64 = 2.2;
pub const BLOOM_DEFAULT: bool = true;

pub const AO_RADIUS: u32 = 14;
pub const AO_STRENGTH: f64 = 0.85;
pub const AO_DEFAULT: bool = true;

pub const VIGNETTE: f64 = 0.32;

// ── Set dressing density ──
pub const PILASTER_EVERY: usize = 5;
pub const BANNER_EVERY: usize = 7;
pub const CLUTTER_EVERY: usize = 6;

// ── Torch flames & motes ──
pub const FLAME_FRAMES: usize = 4;
pub const FLAME_FPS: u32 = 9;
pub const MOTE_RATE: f64 = 2.2;
pub const TORCH_LIGHT_POOL: usize = 6;

// ── Animation FPS Rates ──
pub const FPS_IDLE: u32 = 3;
pub const FPS_WALK: u32 = 8;
pub const FPS_ATTACK: u32 = 12;
pub const FPS_DEATH: u32 = 6;
pub const FPS_ROLL: u32 = 14;
pub const FPS_EQUIP: u32 = 8;
pub const FPS_FORGE: u32 = 7;
pub const FPS_RUN: u32 = 10;
pub const RUN_RATE_RAMP: f64 = 0.6;

// ── Telegraph FPS Rates ──
pub const FPS_CROUCH: u32 = 7;
pub const FPS_WAIT: u32 = 5;
pub const FPS_WAKE: u32 = 10;
pub const FPS_STUMBLE: u32 = 9;

// ── Camera follow ──
pub const CAM_DEADZONE: f64 = 0.7;
pub const CAM_LERP: f64 = 6.0;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sprite_units_is_exact_1_point_5() {
        assert_eq!(SPRITE_UNITS, 1.5);
        for zoom in [CameraZoom::Close, CameraZoom::Normal, CameraZoom::Wide, CameraZoom::Wider, CameraZoom::Widest] {
            let ppu = zoom.ppu();
            assert_eq!(sprite_units(ppu), 1.5);
            assert_eq!(sprite_px(ppu), 2 * sprite_pixel_grid(ppu));
        }
    }

    #[test]
    fn cel_rungs_and_curving() {
        assert_eq!(CEL_STEPS, 10);
        assert_eq!(CEL_CURVE, 0.5);
        assert_eq!(CEL_SATURATION, 1.15);
    }
}
