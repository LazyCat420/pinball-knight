//! The CPU paint surface — the port's stand-in for the legacy hidden canvas.
//!
//! One RGBA8 straight-alpha buffer sized exactly to the pixel-render grid
//! (`PixelSizing.render_w/h`), uploaded by the shell as a `Rgba8Unorm` texture
//! and composited inside the post chain before the cel grade.
//!
//! ## Alpha model
//!
//! Straight (non-premultiplied), composited src-over in float and rounded
//! half-up per channel. Canvas2D stores premultiplied 8-bit; for the opaque
//! palette fills that make up ~all of the UI the two models are identical, and
//! for the one translucent draw (the scrim, onto a cleared buffer) the
//! round-trip difference is ≤1 LSB — inside the fixture compare's tolerance.
//! Glyphs are baked white so their readback was lossless (see bake-gui-font).

/// A straight-alpha colour. Palette entries are opaque.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Rgba {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

impl Rgba {
    pub const fn hex(x: u32) -> Self {
        Self {
            r: ((x >> 16) & 0xff) as u8,
            g: ((x >> 8) & 0xff) as u8,
            b: (x & 0xff) as u8,
            a: 255,
        }
    }

    pub const fn hex_a(x: u32, a: u8) -> Self {
        Self { a, ..Self::hex(x) }
    }

    pub const TRANSPARENT: Rgba = Rgba {
        r: 0,
        g: 0,
        b: 0,
        a: 0,
    };
}

/// Device-space clip: x0, y0, x1, y1 (exclusive).
pub type DeviceClip = (i64, i64, i64, i64);

pub struct Painter {
    pub w: u32,
    pub h: u32,
    /// RGBA8, straight alpha, row-major from the top-left — row 0 is v=0 is
    /// the top of the fullscreen triangle. No flipY anywhere in the wgpu path.
    pub buf: Vec<u8>,
}

impl Painter {
    pub fn new(w: u32, h: u32) -> Self {
        Self {
            w,
            h,
            buf: vec![0; (w * h * 4) as usize],
        }
    }

    /// Match the layer to a new render grid. Contents are undefined after —
    /// the driver clears at the top of every painted frame anyway.
    pub fn resize(&mut self, w: u32, h: u32) {
        self.w = w;
        self.h = h;
        self.buf.clear();
        self.buf.resize((w * h * 4) as usize, 0);
    }

    /// `clearRect(0, 0, w, h)` — back to fully transparent.
    pub fn clear(&mut self) {
        self.buf.fill(0);
    }

    /// Filled rect in DEVICE pixels, src-over, with the canvas negative-size
    /// normalisation (a negative w/h flips the rect rather than drawing nothing).
    pub fn fill_device(
        &mut self,
        x: i64,
        y: i64,
        w: i64,
        h: i64,
        c: Rgba,
        alpha: f64,
        clip: Option<DeviceClip>,
    ) {
        let (x, w) = if w < 0 { (x + w, -w) } else { (x, w) };
        let (y, h) = if h < 0 { (y + h, -h) } else { (y, h) };
        let (mut x0, mut y0, mut x1, mut y1) = (x, y, x + w, y + h);
        if let Some((cx0, cy0, cx1, cy1)) = clip {
            x0 = x0.max(cx0);
            y0 = y0.max(cy0);
            x1 = x1.min(cx1);
            y1 = y1.min(cy1);
        }
        x0 = x0.max(0);
        y0 = y0.max(0);
        x1 = x1.min(self.w as i64);
        y1 = y1.min(self.h as i64);
        if x0 >= x1 || y0 >= y1 {
            return;
        }
        let sa = (c.a as f64 / 255.0) * alpha.clamp(0.0, 1.0);
        if sa >= 1.0 {
            // Opaque fast path — the overwhelmingly common case.
            for py in y0..y1 {
                let row = ((py * self.w as i64 + x0) * 4) as usize;
                for px in 0..(x1 - x0) as usize {
                    let i = row + px * 4;
                    self.buf[i] = c.r;
                    self.buf[i + 1] = c.g;
                    self.buf[i + 2] = c.b;
                    self.buf[i + 3] = 255;
                }
            }
            return;
        }
        if sa <= 0.0 {
            return;
        }
        for py in y0..y1 {
            for px in x0..x1 {
                let i = ((py * self.w as i64 + px) * 4) as usize;
                blend(&mut self.buf[i..i + 4], c, sa);
            }
        }
    }

    /// Blit a coverage (alpha-only) source tinted with `tint`, src-over.
    /// `src` is `sw` wide; the copied region is `(sx, sy, w, h)`; destination
    /// top-left `(dx, dy)` in device pixels.
    #[allow(clippy::too_many_arguments)]
    pub fn blit_coverage(
        &mut self,
        src: &[u8],
        sw: u32,
        sx: u32,
        sy: u32,
        w: u32,
        h: u32,
        dx: i64,
        dy: i64,
        tint: Rgba,
        alpha: f64,
        clip: Option<DeviceClip>,
    ) {
        let alpha = alpha.clamp(0.0, 1.0);
        for row in 0..h as i64 {
            let py = dy + row;
            if py < 0 || py >= self.h as i64 {
                continue;
            }
            for col in 0..w as i64 {
                let px = dx + col;
                if px < 0 || px >= self.w as i64 {
                    continue;
                }
                if let Some((cx0, cy0, cx1, cy1)) = clip {
                    if px < cx0 || px >= cx1 || py < cy0 || py >= cy1 {
                        continue;
                    }
                }
                let cov = src[((sy as i64 + row) * sw as i64 + sx as i64 + col) as usize];
                if cov == 0 {
                    continue;
                }
                let sa = (cov as f64 / 255.0) * (tint.a as f64 / 255.0) * alpha;
                let i = ((py * self.w as i64 + px) * 4) as usize;
                if sa >= 1.0 {
                    self.buf[i] = tint.r;
                    self.buf[i + 1] = tint.g;
                    self.buf[i + 2] = tint.b;
                    self.buf[i + 3] = 255;
                } else {
                    blend(&mut self.buf[i..i + 4], tint, sa);
                }
            }
        }
    }

    pub fn pixel(&self, x: u32, y: u32) -> Rgba {
        let i = ((y * self.w + x) * 4) as usize;
        Rgba {
            r: self.buf[i],
            g: self.buf[i + 1],
            b: self.buf[i + 2],
            a: self.buf[i + 3],
        }
    }

    /// FNV-1a 64 over the buffer — the pin for digest tests.
    pub fn digest(&self) -> u64 {
        let mut h: u64 = 0xcbf29ce484222325;
        for &b in &self.buf {
            h ^= b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
        h
    }
}

/// Straight-alpha src-over, float math, round half-up. `sa` already includes
/// the source colour's own alpha and the global alpha.
fn blend(dst: &mut [u8], c: Rgba, sa: f64) {
    let da = dst[3] as f64 / 255.0;
    let oa = sa + da * (1.0 - sa);
    if oa <= 0.0 {
        dst.copy_from_slice(&[0, 0, 0, 0]);
        return;
    }
    let mix = |s: u8, d: u8| -> u8 {
        let v = (s as f64 * sa + d as f64 * da * (1.0 - sa)) / oa;
        (v + 0.5).floor().clamp(0.0, 255.0) as u8
    };
    dst[0] = mix(c.r, dst[0]);
    dst[1] = mix(c.g, dst[1]);
    dst[2] = mix(c.b, dst[2]);
    dst[3] = ((oa * 255.0) + 0.5).floor().clamp(0.0, 255.0) as u8;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opaque_fill_writes_exact_bytes() {
        let mut p = Painter::new(4, 4);
        p.fill_device(1, 1, 2, 2, Rgba::hex(0x2a1c14), 1.0, None);
        assert_eq!(p.pixel(1, 1), Rgba::hex(0x2a1c14));
        assert_eq!(p.pixel(0, 0), Rgba::TRANSPARENT);
        assert_eq!(p.pixel(3, 3), Rgba::TRANSPARENT);
    }

    #[test]
    fn scrim_on_transparent_matches_the_canvas_readback() {
        // Canvas draws rgba(11,13,18,0.82) onto transparent, stores premultiplied,
        // un-premultiplies on readback: (11,13,18,209). Straight-alpha src-over
        // onto transparent lands on the same bytes.
        let mut p = Painter::new(1, 1);
        p.fill_device(0, 0, 1, 1, Rgba::hex_a(0x0b0d12, 209), 1.0, None);
        assert_eq!(p.pixel(0, 0), Rgba::hex_a(0x0b0d12, 209));
    }

    #[test]
    fn negative_sizes_flip_like_canvas() {
        let mut p = Painter::new(4, 4);
        p.fill_device(3, 3, -2, -2, Rgba::hex(0xffffff), 1.0, None);
        assert_eq!(p.pixel(1, 1), Rgba::hex(0xffffff));
        assert_eq!(p.pixel(2, 2), Rgba::hex(0xffffff));
        assert_eq!(p.pixel(3, 3), Rgba::TRANSPARENT);
    }

    #[test]
    fn clip_bounds_are_exclusive_and_respected() {
        let mut p = Painter::new(4, 4);
        p.fill_device(0, 0, 4, 4, Rgba::hex(0xffffff), 1.0, Some((1, 1, 3, 3)));
        assert_eq!(p.pixel(0, 0), Rgba::TRANSPARENT);
        assert_eq!(p.pixel(1, 1), Rgba::hex(0xffffff));
        assert_eq!(p.pixel(2, 2), Rgba::hex(0xffffff));
        assert_eq!(p.pixel(3, 3), Rgba::TRANSPARENT);
    }
}
