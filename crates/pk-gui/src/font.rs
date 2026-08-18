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
//!
//! PORTS-NOTHING — bitmap font atlas loader for the baked faces

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

/// Characters the FACE does not have, mapped to the one it does.
///
/// ⚠️ **U+2212 MINUS SIGN.** `cards.ts`'s `pct()` prints every negative stat
/// with it — "−12% durability" — and it is deliberately not the ASCII hyphen.
/// Press Start 2P has no such glyph. Baking it anyway was tried and rejected:
/// the browser silently substitutes a proportional system face, so the cell
/// came out 4.51px wide against a monospace 8, which both breaks the layout
/// arithmetic (every screen budgets `size` px per character) and desynced the
/// atlas packing badly enough that the raster bled into its neighbour.
///
/// The oracle has the exact same hole — it draws in Press Start 2P too, so its
/// own minus signs have always been rendered by a fallback face. Copying the
/// bytes faithfully would import that defect into a pixel UI that has no
/// fallback to save it: a glyph the atlas lacks draws NOTHING, and the player
/// reads "12% durability" on a card that makes armour worse.
///
/// So the string stays the oracle's all the way through `pk_core`, and the
/// substitution happens here, at the last possible moment, where it is a
/// rendering decision about a face rather than a rule about a card.
fn substitute(ch: char) -> char {
    match ch {
        '\u{2212}' => '-', // MINUS SIGN → HYPHEN-MINUS
        c => c,
    }
}

pub struct Atlas {
    pub px: u32,
    pub cell_w: u32,
    pub cell_h: u32,
    pub pad: u32,
    pub cols: u32,
    /// Coverage only — glyphs were baked white, so alpha IS the raster.
    pub alpha: Vec<u8>,
    pub width: u32,
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
        self.glyphs.get(&substitute(ch))
    }

    /// This atlas at `k`× its size, by nearest-neighbour on the coverage.
    ///
    /// **This is a bake, not an approximation of one.** Press Start 2P is
    /// authored on the pixel grid, so Skia's raster at `k·px` IS this raster
    /// with every texel repeated `k` times — measured over the whole charset's
    /// alpha, with zero differing samples on all four pairs the baked set
    /// contains (8×2 vs 16, 8×3 vs 24, 16×2 vs 32, 32×2 vs 64). It is
    /// re-proved on every test run by
    /// `derived_sizes_are_byte_identical_to_the_baked_ones`, which is what
    /// keeps this honest if the face is ever re-vendored.
    ///
    /// ⚠️ **THE SCALING IS PER-CELL, NOT WHOLE-ATLAS**, because `pad` does not
    /// scale. The bake uses a constant 2-device-pixel pad at every size
    /// (`cellW = ceil(maxAdvance) + 2·PAD`), so `cellW(8) = 12` and
    /// `cellW(16) = 20` — not 24. Upscaling the whole sheet and calling the
    /// result a 16px atlas puts every glyph 2px off its cell, and the first
    /// draft of this function did exactly that: the test below caught it on
    /// `cell_w` before a single glyph was ever blitted. The GLYPH INTERIORS
    /// scale exactly; the gutter between them does not.
    fn upscaled(&self, k: u32) -> Atlas {
        assert!(k >= 2, "upscale by {k} is not an upscale");
        let pad = self.pad;
        let inner_w = self.cell_w - pad * 2;
        let inner_h = self.cell_h - pad * 2;
        let cell_w = inner_w * k + pad * 2;
        let cell_h = inner_h * k + pad * 2;
        let rows = (self.alpha.len() as u32 / self.width) / self.cell_h;
        let width = self.cols * cell_w;
        let height = rows * cell_h;
        let mut alpha = vec![0u8; (width * height) as usize];
        for row in 0..rows {
            for col in 0..self.cols {
                let (sx0, sy0) = (col * self.cell_w + pad, row * self.cell_h + pad);
                let (dx0, dy0) = (col * cell_w + pad, row * cell_h + pad);
                for y in 0..inner_h * k {
                    let sy = sy0 + y / k;
                    for x in 0..inner_w * k {
                        let sx = sx0 + x / k;
                        alpha[((dy0 + y) * width + dx0 + x) as usize] =
                            self.alpha[(sy * self.width + sx) as usize];
                    }
                }
            }
        }
        Atlas {
            px: self.px * k,
            cell_w,
            cell_h,
            pad,
            cols: self.cols,
            alpha,
            width,
            glyphs: self
                .glyphs
                .iter()
                .map(|(ch, g)| {
                    (
                        *ch,
                        Glyph {
                            index: g.index,
                            advance: g.advance * f64::from(k),
                        },
                    )
                })
                .collect(),
        }
    }

    pub fn cell_origin(&self, index: u32) -> (u32, u32) {
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
        let mut fonts = Fonts { ps2p };
        fonts.derive_missing_zoom_sizes();
        fonts
    }

    /// The device sizes a screen can ask for: the four sizes `text()` accepts,
    /// at every screen zoom the stack can choose.
    ///
    /// `screen_zoom` returns up to `design.max`, and the largest `max` in the
    /// game is the intro chrome's **3** — so `{8,16,24,32} × {1,2,3}`.
    const REQUIRED_DEVICE_SIZES: [u32; 8] = [8, 16, 24, 32, 48, 64, 72, 96];

    /// Fill in any required device size the bake does not ship, by upscaling
    /// the largest baked atlas that divides it exactly.
    ///
    /// Why this exists at all: 72 and 96 were simply absent, and [`Fonts::draw`]
    /// returns on a missing atlas — so the intro's 32pt title, at zoom 3, drew
    /// **nothing**, silently, next to an 8pt hint that rendered fine because
    /// 8×3 = 24 happened to be baked. See [`Atlas::upscaled`] for why deriving
    /// them is exact rather than approximate.
    fn derive_missing_zoom_sizes(&mut self) {
        for want in Self::REQUIRED_DEVICE_SIZES {
            if self.ps2p.contains_key(&want) {
                continue;
            }
            // Largest divisor first: fewer repeated texels is no more accurate
            // here (every factor is exact) but it keeps the derived buffer
            // honest about where it came from.
            let from = self
                .ps2p
                .keys()
                .copied()
                .filter(|px| *px < want && want % *px == 0)
                .max();
            let Some(from) = from else {
                // Not derivable: leave it missing rather than invent a raster.
                // `assert_every_required_size_is_present` is where that becomes
                // a failed test instead of an empty title.
                continue;
            };
            let derived = self.ps2p[&from].upscaled(want / from);
            self.ps2p.insert(want, derived);
        }
    }

    /// Every size a screen can request resolves to an atlas.
    ///
    /// Panics rather than returning a bool: a missing size is not a condition
    /// to branch on, it is text that will not be drawn, and the whole reason
    /// this module grew a derivation step is that the miss was invisible.
    pub fn assert_every_required_size_is_present(&self) {
        for want in Self::REQUIRED_DEVICE_SIZES {
            assert!(
                self.ps2p.contains_key(&want),
                "no PS2P atlas at device size {want} — text at that size draws nothing, silently"
            );
        }
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

    /// A minus sign draws, and it draws at the monospace width.
    ///
    /// `cards.ts` prints "−12%" with U+2212, which Press Start 2P does not
    /// have. Unsubstituted it would measure 0 and draw nothing — the card
    /// would read "12% durability" for a penalty, which is the opposite of
    /// the truth. See [`substitute`] for why this is not fixed in the bake.
    #[test]
    fn the_oracles_minus_sign_draws_as_a_hyphen_at_full_width() {
        let fonts = Fonts::load_embedded();
        assert_eq!(
            fonts.measure("\u{2212}12%", 8),
            4.0 * 8.0,
            "a substituted glyph still occupies exactly one monospace cell"
        );
        // …and it is the SAME raster as the hyphen, not an empty cell that
        // merely reserves the right amount of room.
        let a = fonts.atlas(8).expect("8px atlas");
        assert_eq!(
            a.glyph('\u{2212}').map(|g| g.index),
            a.glyph('-').map(|g| g.index)
        );
        assert!(a.glyph('-').is_some());
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

    #[test]
    fn derived_sizes_are_byte_identical_to_the_baked_ones() {
        // THE PROOF THAT DERIVING IS A BAKE. Every baked pair that is an exact
        // multiple is re-derived from the smaller atlas and compared, byte for
        // byte, against the raster the browser actually produced. If Press
        // Start 2P is ever re-vendored at a size that is not on the pixel grid,
        // or the bake changes its padding, this fails HERE — at the assumption
        // — rather than as a title that is subtly wrong at zoom 3 only.
        let fonts = Fonts::load_embedded();
        for (from, to, k) in [(8u32, 16u32, 2u32), (8, 24, 3), (16, 32, 2), (32, 64, 2)] {
            let src = fonts.atlas(from).expect("baked source atlas");
            let baked = fonts.atlas(to).expect("baked target atlas");
            let derived = src.upscaled(k);
            assert_eq!(derived.px, baked.px, "{from}x{k} px");
            assert_eq!(derived.cell_w, baked.cell_w, "{from}x{k} cell_w");
            assert_eq!(derived.cell_h, baked.cell_h, "{from}x{k} cell_h");
            assert_eq!(derived.pad, baked.pad, "{from}x{k} pad");
            assert_eq!(derived.width, baked.width, "{from}x{k} atlas width");
            assert_eq!(
                derived.alpha.len(),
                baked.alpha.len(),
                "{from}x{k} coverage length"
            );
            let differing = derived
                .alpha
                .iter()
                .zip(&baked.alpha)
                .filter(|(a, b)| a != b)
                .count();
            assert_eq!(
                differing, 0,
                "{from}px upscaled {k}x differs from the baked {to}px atlas in {differing} samples"
            );
        }
    }

    #[test]
    fn every_size_a_screen_can_ask_for_resolves() {
        // The regression this whole derivation exists for: the intro chrome
        // declares `max: 3`, so it asks for 96, and 96 was not baked. Text at a
        // missing size draws NOTHING and says nothing about it.
        let fonts = Fonts::load_embedded();
        fonts.assert_every_required_size_is_present();
        for size in [8u32, 16, 24, 32] {
            for zoom in 1u32..=3 {
                assert!(
                    fonts.atlas(size * zoom).is_some(),
                    "size {size} at zoom {zoom} has no atlas"
                );
            }
        }
    }

    #[test]
    fn a_derived_atlas_advances_like_the_baked_one() {
        // A glyph that lands in the right cell but advances by the base size
        // would draw the title on top of itself. Measured at the API, not the
        // struct: `measure` is what the layout uses.
        let fonts = Fonts::load_embedded();
        assert_eq!(fonts.measure("PINBALL KNIGHT", 96), 14.0 * 96.0);
        assert_eq!(fonts.measure("PINBALL KNIGHT", 72), 14.0 * 72.0);
    }
}
