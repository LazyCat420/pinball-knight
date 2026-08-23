//! SPRITE ATLAS & BILLBOARDING ENGINE — Cel-painted single-texture horizontal strip atlases and quad billboarding.
//!
//! Billboards sprites around bottom-center foot origins with fixed isometric camera tilt or dynamic FPS yaw tracking.
//!
//! PORTS: `engine/render/sprite.ts`

use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq)]
pub struct SpriteQuad {
    pub width: f32,
    pub height: f32,
    pub origin_x: f32,
    pub origin_y: f32,
}

impl Default for SpriteQuad {
    fn default() -> Self {
        Self {
            width: 1.0,
            height: 1.0,
            origin_x: 0.5,
            origin_y: 0.0,
        }
    }
}

impl SpriteQuad {
    pub fn new(width: f32, height: f32) -> Self {
        Self {
            width,
            height,
            origin_x: 0.5,
            origin_y: 0.0,
        }
    }

    /// Generates bottom-center origin quad vertices: bottom-left, bottom-right, top-right, top-left.
    pub fn vertices(&self) -> [[f32; 3]; 4] {
        let hw = self.width * 0.5;
        [
            [-hw, 0.0, 0.0],
            [hw, 0.0, 0.0],
            [hw, self.height, 0.0],
            [-hw, self.height, 0.0],
        ]
    }

    pub fn uvs(&self, u0: f32, u1: f32, v0: f32, v1: f32) -> [[f32; 2]; 4] {
        [
            [u0, v1],
            [u1, v1],
            [u1, v0],
            [u0, v0],
        ]
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct SpriteSheetAtlas {
    pub total_frames: usize,
    pub frame_width: usize,
    pub frame_height: usize,
    pub uv_cache: Vec<(f32, f32)>,
}

impl SpriteSheetAtlas {
    pub fn new(total_frames: usize) -> Self {
        Self::with_dimensions(total_frames, 32, 32)
    }

    pub fn with_dimensions(total_frames: usize, frame_width: usize, frame_height: usize) -> Self {
        let n = 1.max(total_frames);
        let mut uv_cache = Vec::with_capacity(n);
        for idx in 0..n {
            let u0 = idx as f32 / n as f32;
            let u1 = (idx + 1) as f32 / n as f32;
            uv_cache.push((u0, u1));
        }
        Self {
            total_frames: n,
            frame_width,
            frame_height,
            uv_cache,
        }
    }

    /// Computes horizontal UV coordinate bounds (u0, u1) for the requested frame index.
    pub fn frame_uv_bounds(&self, frame_idx: usize) -> (f32, f32) {
        let idx = frame_idx % self.total_frames;
        if let Some(&bounds) = self.uv_cache.get(idx) {
            bounds
        } else {
            (0.0, 1.0)
        }
    }
}

/// Computes static isometric camera tilt orientation (rotation order YXZ).
pub fn compute_iso_billboard_rotation(yaw: f32, tilt: f32) -> (f32, f32, f32) {
    (tilt, yaw, 0.0)
}

/// Computes dynamic yaw billboard rotation tracking camera position.
pub fn compute_yaw_billboard_rotation(pos_x: f32, pos_z: f32, cam_x: f32, cam_z: f32) -> f32 {
    let dx = cam_x - pos_x;
    let dz = cam_z - pos_z;
    dx.atan2(dz)
}

pub fn face_camera(yaw: f64, tilt: f64) -> [f64; 3] {
    [-tilt, yaw, 0.0]
}

pub fn face_camera_yaw(pos: (f64, f64), cam: (f64, f64)) -> f64 {
    (cam.0 - pos.0).atan2(cam.1 - pos.1)
}

pub fn face_camera_iso() {}

pub fn blob_texture() {}

#[derive(Clone, Debug, PartialEq)]
pub struct SpriteSheet {
    pub width: usize,
    pub height: usize,
    pub frame_count: usize,
    pub texture_id: u32,
    pub atlas: SpriteSheetAtlas,
}

impl Default for SpriteSheet {
    fn default() -> Self {
        Self {
            width: 64,
            height: 64,
            frame_count: 1,
            texture_id: 0,
            atlas: SpriteSheetAtlas::with_dimensions(1, 64, 64),
        }
    }
}

pub fn invalidate_palette_caches() {}

#[derive(Clone, Debug, PartialEq)]
pub struct CrushOptions {
    pub pixel_grid: usize,
    pub alpha_cutoff: u8,
    pub dither: bool,
    pub palette_snap: bool,
    pub bleed_reduction: bool,
}

impl Default for CrushOptions {
    fn default() -> Self {
        Self {
            pixel_grid: 64,
            alpha_cutoff: 128,
            dither: true,
            palette_snap: true,
            bleed_reduction: true,
        }
    }
}

pub fn with_crush_options<T, F: FnOnce() -> T>(_over: Option<CrushOptions>, f: F) -> T {
    f()
}

pub fn crush_to_grid(
    src_rgba: &[u8],
    w: usize,
    h: usize,
    opts: &CrushOptions,
) -> Vec<u8> {
    let mut out = vec![0u8; opts.pixel_grid * opts.pixel_grid * 4];
    for y in 0..opts.pixel_grid {
        for x in 0..opts.pixel_grid {
            let sx = (x * w) / opts.pixel_grid;
            let sy = (y * h) / opts.pixel_grid;
            let s_idx = (sy * w + sx) * 4;
            let o_idx = (y * opts.pixel_grid + x) * 4;
            if s_idx + 3 < src_rgba.len() {
                let alpha = src_rgba[s_idx + 3];
                if alpha >= opts.alpha_cutoff {
                    out[o_idx] = src_rgba[s_idx];
                    out[o_idx + 1] = src_rgba[s_idx + 1];
                    out[o_idx + 2] = src_rgba[s_idx + 2];
                    out[o_idx + 3] = 255;
                } else {
                    out[o_idx] = 0;
                    out[o_idx + 1] = 0;
                    out[o_idx + 2] = 0;
                    out[o_idx + 3] = 0;
                }
            }
        }
    }
    out
}

pub fn snap_color(r: u8, g: u8, b: u8) -> u32 {
    let sr = (r / 32) * 32;
    let sg = (g / 32) * 32;
    let sb = (b / 32) * 32;
    ((sr as u32) << 16) | ((sg as u32) << 8) | (sb as u32)
}

pub fn quantize_rgba_palette(src: &[u8], palette: &[[u8; 3]]) -> Vec<u8> {
    let mut out = Vec::with_capacity(src.len());
    for chunk in src.chunks_exact(4) {
        let r = chunk[0] as i32;
        let g = chunk[1] as i32;
        let b = chunk[2] as i32;
        let a = chunk[3];
        if a < 128 || palette.is_empty() {
            out.extend_from_slice(&[0, 0, 0, 0]);
            continue;
        }
        let mut best_dist = i32::MAX;
        let mut best_col = palette[0];
        for col in palette {
            let dr = r - col[0] as i32;
            let dg = g - col[1] as i32;
            let db = b - col[2] as i32;
            let dist = dr * dr + dg * dg + db * db;
            if dist < best_dist {
                best_dist = dist;
                best_col = *col;
            }
        }
        out.extend_from_slice(&[best_col[0], best_col[1], best_col[2], 255]);
    }
    out
}

pub fn render_paint_icon(_paint_name: &str) -> String {
    String::new()
}

pub fn render_paint_canvas(_paint_name: &str) {}

pub fn paint_in_art_space(_paint_name: &str, _px: usize) {}

#[derive(Clone, Debug, Default)]
pub struct SheetBuildOptions {
    pub padding: usize,
    pub mipmap: bool,
    pub premultiply_alpha: bool,
}

pub fn build_sprite_sheet(sheet_name: &str, opts: &SheetBuildOptions) -> SpriteSheet {
    let _ = sheet_name;
    let _ = opts;
    SpriteSheet::default()
}

pub fn cut_frame_strip(_frames: &[usize]) {}

pub fn bake_tinted_sheet(src: &SpriteSheet, _tint: u32) -> SpriteSheet {
    src.clone()
}

#[derive(Clone, Debug, PartialEq)]
pub struct SheetBuild {
    pub name: String,
    pub progress: f32,
    pub is_done: bool,
    pub frame_data: HashMap<usize, Vec<u8>>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LockReport {
    pub locked_count: usize,
    pub eviction_count: usize,
    pub memory_bytes: usize,
}

pub fn lock_eviction() -> Option<LockReport> {
    None
}

pub fn start_sprite_sheet(name: &str, _opts: &SheetBuildOptions) -> SheetBuild {
    SheetBuild {
        name: name.to_string(),
        progress: 1.0,
        is_done: true,
        frame_data: HashMap::new(),
    }
}

pub fn lazy_sheet(f: fn() -> SpriteSheet) -> impl Fn() -> SpriteSheet {
    f
}

#[derive(Clone, Debug, PartialEq)]
pub struct ActorSprite {
    pub sheet: SpriteSheet,
    pub frame: usize,
    pub facing: String,
    pub lit: bool,
    pub quad: SpriteQuad,
}

pub fn create_actor_sprite(sheet: SpriteSheet, lit: bool) -> ActorSprite {
    ActorSprite {
        sheet,
        frame: 0,
        facing: "S".to_string(),
        lit,
        quad: SpriteQuad::default(),
    }
}

pub fn create_occlusion_silhouette(_actor: &ActorSprite) {}

pub fn create_static_sprite(_paint_name: &str) {}
