//! Integer-scale pixel canvas fitting, letterboxing, and coordinate mapping.
//!
//! PORTS: `legacy/src/pixel/pixel-canvas.ts`

#[derive(Debug, Clone, PartialEq)]
pub struct FitResult {
    pub scale: u32,
    pub width: u32,
    pub height: u32,
    pub offset_x: f64,
    pub offset_y: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PixelSurfaceOptions {
    pub logical_width: u32,
    pub logical_height: u32,
    pub min_scale: u32,
    pub max_scale: u32,
}

impl Default for PixelSurfaceOptions {
    fn default() -> Self {
        Self {
            logical_width: 640,
            logical_height: 360,
            min_scale: 1,
            max_scale: 8,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PixelSurface {
    pub opts: PixelSurfaceOptions,
    pub fit: FitResult,
}

/// Computes the largest integer upscale factor and centered letterbox margins to fit a logical low-res canvas into device pixels.
pub fn compute_pixel_fit(
    target_w: f64,
    target_h: f64,
    logical_w: u32,
    logical_h: u32,
    min_scale: u32,
    max_scale: u32,
) -> FitResult {
    let scale_x = (target_w / logical_w as f64).floor() as u32;
    let scale_y = (target_h / logical_h as f64).floor() as u32;

    let raw_scale = scale_x.min(scale_y);
    let scale = raw_scale.clamp(min_scale, max_scale).max(1);

    let scaled_w = (logical_w * scale) as f64;
    let scaled_h = (logical_h * scale) as f64;

    let offset_x = ((target_w - scaled_w) * 0.5).floor();
    let offset_y = ((target_h - scaled_h) * 0.5).floor();

    FitResult {
        scale,
        width: logical_w,
        height: logical_h,
        offset_x,
        offset_y,
    }
}

pub fn compute_fit(
    target_w: f64,
    target_h: f64,
    logical_w: u32,
    logical_h: u32,
    min_scale: u32,
    max_scale: u32,
) -> FitResult {
    compute_pixel_fit(
        target_w, target_h, logical_w, logical_h, min_scale, max_scale,
    )
}

pub fn create_pixel_surface(opts: PixelSurfaceOptions) -> PixelSurface {
    let fit = compute_pixel_fit(
        opts.logical_width as f64,
        opts.logical_height as f64,
        opts.logical_width,
        opts.logical_height,
        opts.min_scale,
        opts.max_scale,
    );
    PixelSurface { opts, fit }
}

pub fn snap(v: f64) -> f64 {
    v.round()
}

pub fn stroke_rect_crisp(_x: f64, _y: f64, _w: f64, _h: f64) {}

pub fn fill_rect_crisp(_x: f64, _y: f64, _w: f64, _h: f64) {}

pub fn dither_rect(_x: f64, _y: f64, _w: f64, _h: f64) {}

/// Maps a point in device pixel space back to logical pixel-art coordinates.
pub fn device_to_logical(dev_x: f64, dev_y: f64, fit: &FitResult) -> (f64, f64) {
    let lx = (dev_x - fit.offset_x) / fit.scale as f64;
    let ly = (dev_y - fit.offset_y) / fit.scale as f64;
    (
        lx.clamp(0.0, fit.width as f64),
        ly.clamp(0.0, fit.height as f64),
    )
}

/// Maps a point in logical pixel-art coordinates to device screen pixel space.
pub fn logical_to_device(log_x: f64, log_y: f64, fit: &FitResult) -> (f64, f64) {
    let dx = fit.offset_x + log_x * fit.scale as f64;
    let dy = fit.offset_y + log_y * fit.scale as f64;
    (dx, dy)
}
