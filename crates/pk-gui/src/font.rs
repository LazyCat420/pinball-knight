//! Browser-baked glyph atlases — the port of `ctx.fillText`.
//!
//! `cargo xtask bake --gui-font` rasterises the vendored faces in the harness
//! browser and writes PNG atlases + metrics. This module decodes them once and
//! blits cells. Because legacy text lands on integer positions (im.ts `px()`
//! rounds x for every alignment) a glyph's pixels depend only on (face, size),
//! so the blit reproduces the canvas raster bit-for-bit.
//!
//! A screen at zoom `z` draws size-`s` text under a ×z transform; Skia scales
//! the outlines, which for this grid-aligned face (zero AA pixels measured at
//! every baked size) equals the `s·z` raster. So blits come from the `s·z`
//! atlas while measurement uses base-size advances, exactly like
//! `measureText` under a transform.

use std::collections::HashMap;

use serde::Deserialize;

use crate::painter::{DeviceClip, Painter, Rgba};

#[derive(Deserialize)]
struct MetricsFile {
    charset: Vec<String>,
    atlases: HashMap<String, AtlasMeta>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AtlasMeta {
    px: u32,
    cell_w: u32,
    cell_h: u32,
    pad: u32,
    cols: u32,
    glyphs: HashMap<String, GlyphMeta>,
}

#[derive(Deserialize)]
struct GlyphMeta {
    i: u32,
    advance: f64,
}

pub struct Glyph {
    pub index: u32,
    pub advance: f64,
}

pub struct Atlas {
    pub px: u32,
    pub cell_w: u32,
    pub cell_h: u32,
    pub pad: u32,
    pub cols: u32,
    /// Coverage only — glyphs were baked white, so alpha IS the raster.
    alpha: Vec<u8>,
    width: u32,
    glyphs: HashMap<char, Glyph>,
}

impl Atlas {
    fn decode(meta: AtlasMeta, png_bytes: &[u8]) -> Atlas {
        let decoder = png::Decoder::new(png_bytes);
        let mut reader = decoder.read_info().expect("gui font atlas: bad PNG");
        let mut buf = vec![0; reader.output_buffer_size()];
        let info = reader
            .next_frame(&mut buf)
            .expect("gui font atlas: bad PNG frame");
        assert_eq!(
            info.color_type,
            png::ColorType::Rgba,
            "gui font atlas must be RGBA8"
        );
        assert_eq!(info.bit_depth, png::BitDepth::Eight);
        let alpha = buf[..info.buffer_size()]
            .chunks_exact(4)
            .map(|p| p[3])
            .collect();
        let glyphs = meta
            .glyphs
            .into_iter()
            .map(|(k, g)| {
                let ch = k.chars().next().expect("empty glyph key");
                (
                    ch,
                    Glyph {
                        index: g.i,
                        advance: g.advance,
                    },
                )
            })
            .collect();
        Atlas {
            px: meta.px,
            cell_w: meta.cell_w,
            cell_h: meta.cell_h,
            pad: meta.pad,
            cols: meta.cols,
            alpha,
            width: info.width,
            glyphs,
        }
    }

    pub fn glyph(&self, ch: char) -> Option<&Glyph> {
        self.glyphs.get(&ch)
    }

    fn cell_origin(&self, index: u32) -> (u32, u32) {
        (
            (index % self.cols) * self.cell_w,
            (index / self.cols) * self.cell_h,
        )
    }
}

pub struct Fonts {
    /// Press Start 2P atlases keyed by device pixel size.
    ps2p: HashMap<u32, Atlas>,
}

macro_rules! baked {
    ($name:literal) => {
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../assets/gui/font/",
            $name
        )) as &[u8]
    };
}

impl Fonts {
    /// Decode the embedded atlases. Call once and share — ~100 KB of PNG work.
    pub fn load_embedded() -> Fonts {
        let metrics: MetricsFile =
            serde_json::from_slice(baked!("metrics.json")).expect("gui font metrics.json");
        assert!(!metrics.charset.is_empty());
        let pngs: [(&str, &[u8]); 6] = [
            ("ps2p-8", baked!("ps2p-8.png")),
            ("ps2p-16", baked!("ps2p-16.png")),
            ("ps2p-24", baked!("ps2p-24.png")),
            ("ps2p-32", baked!("ps2p-32.png")),
            ("ps2p-48", baked!("ps2p-48.png")),
            ("ps2p-64", baked!("ps2p-64.png")),
        ];
        let mut atlases = metrics.atlases;
        let ps2p = pngs
            .into_iter()
            .map(|(name, bytes)| {
                let meta = atlases
                    .remove(name)
                    .unwrap_or_else(|| panic!("metrics.json lacks {name}"));
                (meta.px, Atlas::decode(meta, bytes))
            })
            .collect();
        Fonts { ps2p }
    }

    pub fn atlas(&self, device_px: u32) -> Option<&Atlas> {
        self.ps2p.get(&device_px)
    }

    /// `measureText(s).width` at the BASE size, in UI pixels. Sum of advances —
    /// correct for these faces (no kerning; PS2P advance == size exactly).
    pub fn measure(&self, s: &str, size: u32) -> f64 {
        let Some(atlas) = self.ps2p.get(&size) else {
            // No atlas at that size: monospace assumption, the same shape as
            // the legacy pre-fonts fallback.
            return s.chars().count() as f64 * size as f64;
        };
        s.chars()
            .map(|ch| atlas.glyph(ch).map_or(atlas.px as f64, |g| g.advance))
            .sum()
    }

    /// Draw `s` with its pen starting at DEVICE `(pen_x, top_y)` from the
    /// `size · zoom` atlas. `top_y` is the `textBaseline = "top"` line the cell
    /// was captured against.
    #[allow(clippy::too_many_arguments)]
    pub fn draw(
        &self,
        p: &mut Painter,
        s: &str,
        device_size: u32,
        pen_x: i64,
        top_y: i64,
        tint: Rgba,
        alpha: f64,
        clip: Option<DeviceClip>,
    ) {
        let Some(atlas) = self.ps2p.get(&device_size) else {
            return;
        };
        let mut pen = pen_x as f64;
        for ch in s.chars() {
            let Some(g) = atlas.glyph(ch) else {
                pen += atlas.px as f64;
                continue;
            };
            let (sx, sy) = atlas.cell_origin(g.index);
            p.blit_coverage(
                &atlas.alpha,
                atlas.width,
                sx,
                sy,
                atlas.cell_w,
                atlas.cell_h,
                // PS2P advances are integers, so the pen stays integral and
                // this round is the identity; it guards the VT323 future.
                (pen + 0.5).floor() as i64 - atlas.pad as i64,
                top_y - atlas.pad as i64,
                tint,
                alpha,
                clip,
            );
            pen += g.advance;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_atlases_decode_and_advances_are_the_point_size() {
        let fonts = Fonts::load_embedded();
        for size in [8u32, 16, 24, 32, 48, 64] {
            let a = fonts
                .atlas(size)
                .unwrap_or_else(|| panic!("no atlas at {size}"));
            assert_eq!(a.px, size);
            let g = a.glyph('A').expect("A missing");
            assert_eq!(g.advance, size as f64, "PS2P advance must equal the size");
        }
    }

    #[test]
    fn measure_is_monospace_at_the_base_size() {
        let fonts = Fonts::load_embedded();
        assert_eq!(fonts.measure("ABC", 8), 24.0);
        assert_eq!(fonts.measure("[E] FORGE / REPAIR", 8), 18.0 * 8.0);
        assert_eq!(fonts.measure("RUN SUMMARY", 16), 11.0 * 16.0);
    }

    #[test]
    fn size_8_glyphs_carry_zero_antialiasing() {
        // The bit-exactness argument rests on this: hard-edged coverage means
        // blit order and blending can never diverge from the canvas by rounding.
        let fonts = Fonts::load_embedded();
        let a = fonts.atlas(8).unwrap();
        assert!(
            a.alpha.iter().all(|&v| v == 0 || v == 255),
            "ps2p-8 has AA pixels"
        );
    }
}
