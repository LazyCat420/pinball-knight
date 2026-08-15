//! Arc Kickers — curved rubber bumpers on swept maze walls.
//!
//! PORTS: `render/arc-kickers.ts`

use super::arc_lanes::GeometryBuffers;

pub const C_KICK_RUBBER_INDEX: usize = 11; // blood dark
pub const C_KICK_LIT_INDEX: usize = 16; // flame gold
pub const C_KICK_HOT_INDEX: usize = 18; // flame core

pub const ARC_KICK_FLASH: f64 = 0.18;
pub const ARC_KICK_THICK: f64 = 0.08;

#[derive(Clone, Debug, PartialEq)]
pub struct KickBand {
    pub a0: f64,
    pub span: f64,
}

/// Generates curved rubber slab geometry with capped top surface.
pub fn build_kicker_geometry(
    cxw: f64,
    czw: f64,
    r: f64,
    a0: f64,
    span: f64,
    y0: f64,
    y1: f64,
    off: f64,
) -> GeometryBuffers {
    let seg = (span * r * 8.0).ceil().max(6.0) as usize;
    let mut pos = Vec::new();
    let mut nor = Vec::new();
    let mut uvs = Vec::new();
    let mut index = Vec::new();
    let rr = r + off;

    // Vertical band face
    for s in 0..=seg {
        let a = a0 + (span * s as f64) / seg as f64;
        let dx = a.cos();
        let dz = a.sin();
        let x = (cxw + dx * rr) as f32;
        let z = (czw + dz * rr) as f32;

        pos.extend_from_slice(&[x, y0 as f32, z, x, y1 as f32, z]);
        nor.extend_from_slice(&[dx as f32, 0.0, dz as f32, dx as f32, 0.0, dz as f32]);
        let u = (s as f32) / (seg as f32);
        uvs.extend_from_slice(&[u, 0.0, u, 1.0]);
    }

    for s in 0..seg {
        let v0 = (s * 2) as u32;
        index.extend_from_slice(&[v0, v0 + 2, v0 + 1, v0 + 1, v0 + 2, v0 + 3]);
    }

    // Top cap along the slab edge
    let cap_base = (pos.len() / 3) as u32;
    for s in 0..=seg {
        let a = a0 + (span * s as f64) / seg as f64;
        let dx = a.cos();
        let dz = a.sin();

        let x_wall = (cxw + dx * r) as f32;
        let z_wall = (czw + dz * r) as f32;
        let x_face = (cxw + dx * rr) as f32;
        let z_face = (czw + dz * rr) as f32;

        pos.extend_from_slice(&[x_wall, y1 as f32, z_wall, x_face, y1 as f32, z_face]);
        nor.extend_from_slice(&[0.0, 1.0, 0.0, 0.0, 1.0, 0.0]);
        let u = (s as f32) / (seg as f32);
        uvs.extend_from_slice(&[u, 0.0, u, 1.0]);
    }

    for s in 0..seg {
        let v0 = cap_base + (s * 2) as u32;
        index.extend_from_slice(&[v0, v0 + 1, v0 + 2, v0 + 1, v0 + 3, v0 + 2]);
    }

    GeometryBuffers {
        positions: pos,
        normals: nor,
        uvs,
        indices: index,
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ArcKickerVisual {
    pub band: KickBand,
    pub x: f64,
    pub z: f64,
    pub flash_t: f64,
    pub body_geo: GeometryBuffers,
    pub rail_geo: GeometryBuffers,
}

impl ArcKickerVisual {
    pub fn new(band: KickBand, cxw: f64, czw: f64, r: f64, h: f64, solid_out: bool) -> Self {
        let off = if solid_out { -ARC_KICK_THICK } else { ARC_KICK_THICK };
        let y0 = h * 0.16;
        let y1 = h * 0.78;

        let body_geo = build_kicker_geometry(cxw, czw, r, band.a0, band.span, y0, y1, off);
        let rail_geo = build_kicker_geometry(
            cxw,
            czw,
            r,
            band.a0,
            band.span,
            y1,
            y1 + 0.055,
            off * 1.25,
        );

        let mid = band.a0 + band.span / 2.0;
        let x = cxw + mid.cos() * (r + off);
        let z = czw + mid.sin() * (r + off);

        Self {
            band,
            x,
            z,
            flash_t: 0.0,
            body_geo,
            rail_geo,
        }
    }

    pub fn trigger_kick(&mut self) {
        self.flash_t = ARC_KICK_FLASH;
    }

    pub fn tick(&mut self, dt: f64) {
        if self.flash_t > 0.0 {
            self.flash_t = (self.flash_t - dt).max(0.0);
        }
    }

    pub fn is_flashing(&self) -> bool {
        self.flash_t > 0.0
    }
}
