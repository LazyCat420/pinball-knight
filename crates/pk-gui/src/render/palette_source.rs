//! Palette Source — Provides quantization palettes, RGB float uploads, and dither parameters.
//!
//! PORTS: `engine/palette-source.ts`

use super::palette_shading::{SHADE_DOWN, SHADE_UP};

#[derive(Clone, Debug, PartialEq)]
pub struct PaletteSource {
    pub size: usize,
    pub colors_rgb: Vec<[f32; 3]>,
    pub colors_hex: Vec<u32>,
    pub occlusion_index: usize,
    pub shade_down: Vec<u8>,
    pub shade_up: Vec<u8>,
}

impl PaletteSource {
    /// Cold Crypt 32-color master palette source for Pinball Knight.
    pub fn cold_crypt() -> Self {
        // Cold Crypt palette hex colors
        let colors_hex: Vec<u32> = vec![
            0x000000, 0x14182e, 0x242846, 0x3d4166, 0x60648c, 0x8f93ba, 0xc7cbdb, 0xffffff,
            0x4b1e2a, 0x782c3c, 0xad3d4e, 0xdc585c, 0xf08070, 0xfcb080, 0x38281a, 0x5a3d24,
            0x8c5b30, 0xbd7d3a, 0xe0a34a, 0xf7cd6d, 0x1e382b, 0x2c5a3e, 0x3d8554, 0x58b06d,
            0x7de08d, 0xb8fcb0, 0x2a2438, 0x483a5e, 0x6e528a, 0x9b70b8, 0xca96e0, 0xf5ccff,
        ];

        let mut colors_rgb = Vec::with_capacity(32);
        for &hex in &colors_hex {
            let r = ((hex >> 16) & 0xFF) as f32 / 255.0;
            let g = ((hex >> 8) & 0xFF) as f32 / 255.0;
            let b = (hex & 0xFF) as f32 / 255.0;
            colors_rgb.push([r, g, b]);
        }

        Self {
            size: 32,
            colors_rgb,
            colors_hex,
            occlusion_index: 30,
            shade_down: SHADE_DOWN.to_vec(),
            shade_up: SHADE_UP.to_vec(),
        }
    }

    /// Neutral 16-step greyscale fallback palette for standalone testing.
    pub fn fallback_greyscale() -> Self {
        let mut colors_rgb = Vec::with_capacity(16);
        let mut colors_hex = Vec::with_capacity(16);
        let mut shade_down = Vec::with_capacity(16);
        let mut shade_up = Vec::with_capacity(16);

        for i in 0..16u8 {
            let v = i as f32 / 15.0;
            colors_rgb.push([v, v, v]);
            let iv = (v * 255.0).round() as u32;
            colors_hex.push((iv << 16) | (iv << 8) | iv);
            shade_down.push(i.saturating_sub(1));
            shade_up.push((i + 1).min(15));
        }

        Self {
            size: 16,
            colors_rgb,
            colors_hex,
            occlusion_index: 10,
            shade_down,
            shade_up,
        }
    }

    /// Dither strength derived as 2 / size.
    pub fn dither_strength(&self) -> f32 {
        2.0 / self.size as f32
    }

    /// Flattened RGB float array (3 floats per entry) for shader uniform upload.
    pub fn to_float_array(&self) -> Vec<f32> {
        let mut floats = Vec::with_capacity(self.size * 3);
        for rgb in &self.colors_rgb {
            floats.push(rgb[0]);
            floats.push(rgb[1]);
            floats.push(rgb[2]);
        }
        floats
    }

    /// Returns the CSS hex color string (e.g., `#ffffff`) for canvas 2D painting.
    pub fn css(&self, index: usize) -> String {
        let hex = self.colors_hex.get(index).copied().unwrap_or(0);
        format!("#{:06x}", hex)
    }
}
