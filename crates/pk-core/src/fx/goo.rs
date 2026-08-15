//! Oil and Tar Viscous Fluid Math — Shared procedural shader graph with inverted film, rim, and flow parameters.
//!
//! PORTS: `fx/elements/goo.ts`

use super::noise::{band_ramp, disc_mask, disc_p, fbm01, warp};

pub const OIL_RAMP: [u8; 6] = [0, 26, 29, 19, 30, 31];
pub const OIL_STOPS: [f64; 5] = [0.14, 0.34, 0.52, 0.70, 0.88];

pub const TAR_RAMP: [u8; 3] = [0, 26, 27];
pub const TAR_STOPS: [f64; 2] = [0.30, 0.68];

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GooOpts {
    pub film: f64,
    pub rim: f64,
    pub flow: f64,
}

impl GooOpts {
    pub const fn oil() -> Self {
        Self {
            film: 1.0,
            rim: 0.9,
            flow: 1.0,
        }
    }

    pub const fn tar() -> Self {
        Self {
            film: 0.0,
            rim: 0.0,
            flow: 0.12,
        }
    }
}

/// Evaluates procedural viscous fluid field at UV coordinates `(u, v)` in `[0, 1]^2`.
/// Returns `(palette_index, alpha)`.
pub fn sample_goo(u: f64, v: f64, time: f64, opts: GooOpts, is_tar: bool) -> (u8, f64) {
    let (px, py) = disc_p(u, v);
    let r = (px * px + py * py).sqrt();

    // Heavy fluid domain warp
    let (wx, wy) = warp(px + time * 0.18 * opts.flow, py + time * 0.18 * opts.flow, 0.16);

    // Thickness varies smoothly via noise
    let thick = fbm01(wx * 2.1, wy * 2.1 + time * 0.22 * opts.flow, 3);

    // Thin-film interference sheen
    let sheen = if opts.film <= 0.0 {
        0.0
    } else {
        let phase = thick * 9.0 + r * 2.4 + time * 0.5 * opts.flow;
        ((phase.sin() * 0.5 + 0.5) * opts.film).clamp(0.0, 1.0)
    };

    // Rim highlight: smoothstep(0.70, 0.99, r) * rim
    let edge = if opts.rim <= 0.0 || r <= 0.70 {
        0.0
    } else if r >= 0.99 {
        opts.rim
    } else {
        let t = ((r - 0.70) / (0.99 - 0.70)).clamp(0.0, 1.0);
        (t * t * (3.0 - 2.0 * t)) * opts.rim
    };

    let body = (thick * 0.34 + sheen * 0.40 + edge * 0.42).clamp(0.0, 1.0);

    let pal_idx = if is_tar {
        band_ramp(body, &TAR_STOPS, &TAR_RAMP)
    } else {
        band_ramp(body, &OIL_STOPS, &OIL_RAMP)
    };

    let alpha = disc_mask(u, v, 0.92, 1.0);

    (pal_idx, alpha)
}
