//! Pixel Icons — Turn raster graphics into quantized, Bayer-dithered pixel-art bitmaps.
//!
//! PORTS: `legacy/src/pixel/pixel-icon.ts`

pub const BAYER4: [[i32; 4]; 4] = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
];

pub const DITHER_AMP: i32 = 6;
pub const ALPHA_CUTOFF: u8 = 128;

#[derive(Clone, Debug, PartialEq)]
pub struct RasterizeOptions {
    pub size: usize,
    pub palette: Option<Vec<[u8; 3]>>,
    pub dither: bool,
    pub alpha_cutoff: u8,
    pub dither_amp: i32,
}

impl Default for RasterizeOptions {
    fn default() -> Self {
        Self {
            size: 16,
            palette: None,
            dither: true,
            alpha_cutoff: ALPHA_CUTOFF,
            dither_amp: DITHER_AMP,
        }
    }
}

/// Finds the nearest color in a given palette by Euclidean RGB distance.
pub fn quantize_color(rgb: [u8; 3], palette: &[[u8; 3]]) -> [u8; 3] {
    if palette.is_empty() {
        return rgb;
    }

    let mut best_color = palette[0];
    let mut best_dist = i32::MAX;

    for &p in palette {
        let dr = rgb[0] as i32 - p[0] as i32;
        let dg = rgb[1] as i32 - p[1] as i32;
        let db = rgb[2] as i32 - p[2] as i32;
        let dist = dr * dr + dg * dg + db * db;

        if dist < best_dist {
            best_dist = dist;
            best_color = p;
        }
    }

    best_color
}

/// Crushes an RGBA pixel buffer to a pixel grid with ordered dithering and palette snapping.
pub fn crush_pixel_art(
    src_rgba: &[u8],
    width: usize,
    height: usize,
    opts: &RasterizeOptions,
) -> Vec<u8> {
    let out_size = opts.size;
    let mut out = vec![0u8; out_size * out_size * 4];

    for oy in 0..out_size {
        for ox in 0..out_size {
            // Nearest or area sampling coordinate
            let sx = (ox * width) / out_size;
            let sy = (oy * height) / out_size;
            let src_idx = (sy * width + sx) * 4;

            if src_idx + 3 >= src_rgba.len() {
                continue;
            }

            let a = src_rgba[src_idx + 3];
            if a < opts.alpha_cutoff {
                // Hard silhouette cutout
                continue;
            }

            let mut r = src_rgba[src_idx] as i32;
            let mut g = src_rgba[src_idx + 1] as i32;
            let mut b = src_rgba[src_idx + 2] as i32;

            if opts.dither && opts.palette.is_some() {
                // Bayer 4x4 matrix bias normalized to [-0.5, 0.5] * dither_amp
                let bayer_val = BAYER4[oy % 4][ox % 4];
                let bias = ((bayer_val as f32 / 15.0 - 0.5) * opts.dither_amp as f32) as i32;
                r = (r + bias).clamp(0, 255);
                g = (g + bias).clamp(0, 255);
                b = (b + bias).clamp(0, 255);
            }

            let [fr, fg, fb] = if let Some(pal) = &opts.palette {
                quantize_color([r as u8, g as u8, b as u8], pal)
            } else {
                [r as u8, g as u8, b as u8]
            };

            let out_idx = (oy * out_size + ox) * 4;
            out[out_idx] = fr;
            out[out_idx + 1] = fg;
            out[out_idx + 2] = fb;
            out[out_idx + 3] = 255;
        }
    }

    out
}
