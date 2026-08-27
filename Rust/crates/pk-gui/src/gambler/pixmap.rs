//! PIXMAP — the RGBA8 scratch surface the gambler's art rasterises into.
//!
//! PORTS-NOTHING. The oracle's art paints into a `CanvasRenderingContext2D`;
//! there is no such context here, and the shell deliberately hands each game a
//! flat paint list rather than a painter (see `screens::gambler`). So the art
//! that genuinely needs per-pixel work — a rasterised ellipse — gets a surface
//! of its own, and the finished surface reaches the screen as ONE blit.
//!
//! ## Why not paint straight into `Painter`
//!
//! `Painter` is in DEVICE pixels, already scaled by the frame's `zoom`. The
//! wheel is authored in UI pixels on an integer grid, and the entire reason it
//! is rasterised by hand (rather than drawn with an `arc()`) is that every
//! pixel must land on that grid exactly. Rasterising at device scale would put
//! the wheel's pixel boundaries at fractional UI positions at any zoom above 1
//! — the blurry-PNG failure the oracle's header spends a paragraph on, arrived
//! at from the other direction.
//!
//! So: rasterise at 1:1 into a `Pixmap`, then let `blit_rgba` do the integer
//! upscale. `imageSmoothingEnabled = false` is the nearest-neighbour in
//! `Painter::blit_rgba`, and a whole-number `zoom` keeps it square-pixelled.
//!
//! ## Straight alpha, and why every write is opaque
//!
//! The gambler's ramps are opaque; alpha here is a two-state mask — painted or
//! not — and never a shading tool. The oracle says why: alpha shading on a 2D
//! canvas fringes, so the art shades by picking a different ramp entry
//! instead. `over()` therefore only has to answer "did the source paint this
//! pixel?", which is what keeps the three-layer composite exact rather than
//! accumulating rounding across blends.

use crate::painter::Rgba;

/// A straight-alpha RGBA8 surface. Row-major, 4 bytes per pixel.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pixmap {
    pub w: usize,
    pub h: usize,
    pub buf: Vec<u8>,
}

impl Pixmap {
    /// A fully TRANSPARENT surface. The three wheel layers rely on this: `mid`
    /// and `far` are mostly empty and must not erase what they land on.
    pub fn new(w: usize, h: usize) -> Self {
        Self {
            w,
            h,
            buf: vec![0; w * h * 4],
        }
    }

    pub fn clear(&mut self) {
        self.buf.fill(0);
    }

    /// Fill the whole surface — the cabinet's background, before the wheel.
    pub fn fill(&mut self, c: Rgba) {
        for i in (0..self.buf.len()).step_by(4) {
            self.buf[i] = c.r;
            self.buf[i + 1] = c.g;
            self.buf[i + 2] = c.b;
            self.buf[i + 3] = c.a;
        }
    }

    /// One horizontal run, `[x0, x1)` on row `y`. THE hot path: `paint_disc`
    /// emits one of these per span of identical colour, which is the whole
    /// reason a wheel is a few thousand writes and not ~19,000.
    pub fn span(&mut self, x0: i64, x1: i64, y: i64, c: Rgba) {
        if y < 0 || y >= self.h as i64 {
            return;
        }
        let x0 = x0.max(0) as usize;
        let x1 = (x1.min(self.w as i64)).max(0) as usize;
        if x1 <= x0 {
            return;
        }
        let row = y as usize * self.w * 4;
        for x in x0..x1 {
            let i = row + x * 4;
            self.buf[i] = c.r;
            self.buf[i + 1] = c.g;
            self.buf[i + 2] = c.b;
            self.buf[i + 3] = c.a;
        }
    }

    /// `fillRect`, clipped. Negative or zero extents draw nothing, which is
    /// what the canvas does and what several callers below rely on.
    pub fn fill_rect(&mut self, x: i64, y: i64, w: i64, h: i64, c: Rgba) {
        if w <= 0 || h <= 0 {
            return;
        }
        for row in y..y + h {
            self.span(x, x + w, row, c);
        }
    }

    /// Source-over composite of a same-sized layer.
    ///
    /// Opaque-or-nothing, per the module header — a source pixel with any alpha
    /// replaces the destination, and `a == 0` leaves it alone.
    pub fn over(&mut self, src: &Pixmap) {
        debug_assert_eq!((self.w, self.h), (src.w, src.h), "over() needs same dims");
        let n = self.buf.len().min(src.buf.len());
        for i in (0..n).step_by(4) {
            if src.buf[i + 3] == 0 {
                continue;
            }
            self.buf[i] = src.buf[i];
            self.buf[i + 1] = src.buf[i + 1];
            self.buf[i + 2] = src.buf[i + 2];
            self.buf[i + 3] = src.buf[i + 3];
        }
    }

    pub fn bytes(&self) -> &[u8] {
        &self.buf
    }

    pub fn pixel(&self, x: usize, y: usize) -> Rgba {
        let i = (y * self.w + x) * 4;
        Rgba {
            r: self.buf[i],
            g: self.buf[i + 1],
            b: self.buf[i + 2],
            a: self.buf[i + 3],
        }
    }

    /// FNV-1a over the whole surface.
    ///
    /// This is the ONLY honest oracle for procedural art: a digest fails when
    /// any pixel moves, where a geometry assertion on the projection can pass
    /// while nothing is drawn at all — which is exactly what the test this
    /// replaces did.
    pub fn digest(&self) -> u64 {
        let mut h: u64 = 0xcbf2_9ce4_8422_2325;
        for b in &self.buf {
            h ^= *b as u64;
            h = h.wrapping_mul(0x0000_0100_0000_01b3);
        }
        h
    }

    /// Count of painted (non-transparent) pixels. A cheap "did anything
    /// happen?" that reads better in a failure message than a digest.
    pub fn painted(&self) -> usize {
        self.buf.chunks_exact(4).filter(|p| p[3] != 0).count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_is_transparent() {
        let pm = Pixmap::new(4, 4);
        assert_eq!(pm.painted(), 0);
        assert_eq!(pm.pixel(2, 2), Rgba::TRANSPARENT);
    }

    #[test]
    fn span_clips_both_ends_without_wrapping_rows() {
        let mut pm = Pixmap::new(4, 2);
        // Runs off both edges of row 0. A wrap would paint row 1.
        pm.span(-5, 99, 0, Rgba::hex(0xff0000));
        assert_eq!(pm.painted(), 4, "row 0 filled, and only row 0");
        assert_eq!(pm.pixel(0, 1), Rgba::TRANSPARENT);
    }

    #[test]
    fn span_off_surface_is_a_noop() {
        let mut pm = Pixmap::new(4, 4);
        pm.span(0, 4, -1, Rgba::hex(0xffffff));
        pm.span(0, 4, 4, Rgba::hex(0xffffff));
        assert_eq!(pm.painted(), 0);
    }

    #[test]
    fn fill_rect_ignores_empty_extents() {
        let mut pm = Pixmap::new(4, 4);
        pm.fill_rect(0, 0, 0, 3, Rgba::hex(0xffffff));
        pm.fill_rect(0, 0, 3, -2, Rgba::hex(0xffffff));
        assert_eq!(pm.painted(), 0);
    }

    #[test]
    fn over_keeps_destination_where_source_is_transparent() {
        let red = Rgba::hex(0xff0000);
        let blue = Rgba::hex(0x0000ff);
        let mut dst = Pixmap::new(2, 1);
        dst.fill(red);
        let mut src = Pixmap::new(2, 1);
        src.span(0, 1, 0, blue); // only pixel 0
        dst.over(&src);
        assert_eq!(dst.pixel(0, 0), blue);
        assert_eq!(dst.pixel(1, 0), red, "an unpainted source pixel must not erase");
    }

    #[test]
    fn digest_moves_when_one_pixel_does() {
        let mut a = Pixmap::new(3, 3);
        a.fill(Rgba::hex(0x112233));
        let before = a.digest();
        a.span(1, 2, 1, Rgba::hex(0x112234));
        assert_ne!(before, a.digest());
    }
}
