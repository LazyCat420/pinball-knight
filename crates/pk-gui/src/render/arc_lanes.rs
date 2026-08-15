//! Arc Lanes — curved speed booster strips on swept maze walls.
//!
//! PORTS: `render/arc-lanes.ts`

pub const C_LANE_BED_INDEX: usize = 29; // arcane dark
pub const C_LANE_LIT_INDEX: usize = 30; // arcane mid
pub const C_LANE_HOT_INDEX: usize = 31; // arcane light

pub const ARC_LANE_FLASH: f64 = 0.22;
pub const ARC_LANE_THICK: f64 = 0.08;
pub const CHEVRONS_PER_RAD: f64 = 3.2;

#[derive(Clone, Debug, PartialEq, Default)]
pub struct GeometryBuffers {
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    pub uvs: Vec<f32>,
    pub indices: Vec<u32>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LaneBand {
    pub a0: f64,
    pub span: f64,
    pub cw: bool,
    pub mouth: (f64, f64),
}

/// Generates curved bed slab geometry along an arc sub-span.
pub fn build_bed_geometry(
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

    GeometryBuffers {
        positions: pos,
        normals: nor,
        uvs,
        indices: index,
    }
}

/// Generates directional >-shaped chevrons along the speed lane.
pub fn build_chevron_geometry(
    cxw: f64,
    czw: f64,
    r: f64,
    a0: f64,
    span: f64,
    y0: f64,
    y1: f64,
    off: f64,
    cw: bool,
) -> GeometryBuffers {
    let n = (span * CHEVRONS_PER_RAD).round().max(2.0) as usize;
    let mut pos = Vec::new();
    let mut nor = Vec::new();
    let mut uvs = Vec::new();
    let mut index = Vec::new();
    let rr = r + off;

    let step = span / (n + 1) as f64;
    let half = (step * 0.34).min(0.13);
    let y_mid = (y0 + y1) / 2.0;
    let y_half = (y1 - y0) * 0.3;

    for c in 1..=n {
        let a_mid = a0 + step * c as f64;
        let dir = if cw { 1.0 } else { -1.0 };
        let a_apex = a_mid + half * dir;
        let a_tail = a_mid - half * dir;

        let at = |a: f64, y: f64| -> [f32; 3] {
            [
                (cxw + a.cos() * rr) as f32,
                y as f32,
                (czw + a.sin() * rr) as f32,
            ]
        };

        let apex = at(a_apex, y_mid);
        let top = at(a_tail, y_mid + y_half);
        let bot = at(a_tail, y_mid - y_half);
        let mid_top = at(a_apex - half * dir * 0.45, y_mid + y_half * 0.42);
        let mid_bot = at(a_apex - half * dir * 0.45, y_mid - y_half * 0.42);

        let base = (pos.len() / 3) as u32;
        for v in &[apex, top, mid_top, apex, bot, mid_bot] {
            pos.extend_from_slice(v);
        }

        for k in 0..6 {
            let a = if k < 3 { a_apex } else { a_tail };
            nor.extend_from_slice(&[a.cos() as f32, 0.0, a.sin() as f32]);
            uvs.extend_from_slice(&[0.0, 0.0]);
        }

        index.extend_from_slice(&[base, base + 1, base + 2, base + 3, base + 5, base + 4]);
    }

    GeometryBuffers {
        positions: pos,
        normals: nor,
        uvs,
        indices: index,
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ArcLaneVisual {
    pub band: LaneBand,
    pub x: f64,
    pub z: f64,
    pub flash_t: f64,
    pub bed_geo: GeometryBuffers,
    pub chevron_geo: GeometryBuffers,
}

impl ArcLaneVisual {
    pub fn new(band: LaneBand, cxw: f64, czw: f64, r: f64, h: f64, solid_out: bool) -> Self {
        let off = if solid_out { -ARC_LANE_THICK } else { ARC_LANE_THICK };
        let y0 = h * 0.06;
        let y1 = h * 0.42;

        let bed_geo = build_bed_geometry(cxw, czw, r, band.a0, band.span, y0, y1, off);
        let chevron_geo = build_chevron_geometry(
            cxw,
            czw,
            r,
            band.a0,
            band.span,
            y0,
            y1,
            off + if solid_out { -0.006 } else { 0.006 },
            band.cw,
        );

        let mid = band.a0 + band.span / 2.0;
        let x = cxw + mid.cos() * (r + off);
        let z = czw + mid.sin() * (r + off);

        Self {
            band,
            x,
            z,
            flash_t: 0.0,
            bed_geo,
            chevron_geo,
        }
    }

    pub fn trigger_boost(&mut self) {
        self.flash_t = ARC_LANE_FLASH;
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
