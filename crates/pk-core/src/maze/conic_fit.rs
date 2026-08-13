//! CONIC FIT — ellipses and parabolas, expressed as chains of circular arcs.
//!
//! PORTS: `maze/conic-fit.ts`

use std::f64::consts::{PI, TAU};

use crate::tile_shape::ArcFeature;


#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Pt {
    pub x: f64,
    pub z: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ConicSample {
    pub x: f64,
    pub z: f64,
    pub nx: f64,
    pub nz: f64,
}

pub const MAX_ARC_RADIUS: f64 = 160.0;
pub const MIN_ARC_RADIUS: f64 = 0.75;
pub const THROAT_ANGLE_DEG: f64 = 32.0;

pub fn normal_intersection(a: &ConicSample, b: &ConicSample) -> Option<Pt> {
    let det = a.nx * (-b.nz) - a.nz * (-b.nx);
    if det.abs() < 1e-9 {
        return None;
    }
    let rx = b.x - a.x;
    let rz = b.z - a.z;
    let s = (rx * (-b.nz) - rz * (-b.nx)) / det;
    Some(Pt {
        x: a.x + a.nx * s,
        z: a.z + a.nz * s,
    })
}

fn arc_radius(c: Pt, a: &ConicSample, b: &ConicSample) -> f64 {
    ((a.x - c.x).hypot(a.z - c.z) + (b.x - c.x).hypot(b.z - c.z)) / 2.0
}

pub fn arc_chain_from_samples(
    samples: &[ConicSample],
    solid_out: bool,
    owner: Option<&'static str>,
) -> Vec<ArcFeature> {
    let mut out = Vec::new();
    if samples.len() < 2 {
        return out;
    }
    for k in 0..samples.len() - 1 {
        let a = &samples[k];
        let b = &samples[k + 1];
        let Some(c) = normal_intersection(a, b) else {
            continue;
        };
        let r = arc_radius(c, a, b);
        if !(r >= MIN_ARC_RADIUS && r <= MAX_ARC_RADIUS) {
            continue;
        }

        let a0raw = (a.z - c.z).atan2(a.x - c.x);
        let a1raw = (b.z - c.z).atan2(b.x - c.x);
        let mut d = (a1raw - a0raw) % TAU;
        if d > PI {
            d -= TAU;
        }
        if d < -PI {
            d += TAU;
        }
        if d.abs() < 1e-6 {
            continue;
        }

        out.push(ArcFeature {
            cx: c.x,
            cz: c.z,
            r,
            a0: if d > 0.0 { a0raw } else { a1raw },
            span: d.abs(),
            solid_out,
            owner,
            kicks: Vec::new(),
            lanes: Vec::new(),
        });
    }
    out
}


#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Ellipse {
    pub ox: f64,
    pub oz: f64,
    pub a: f64,
    pub b: f64,
    pub ux: f64,
    pub uz: f64,
}

pub fn ellipse_from_foci(f1: Pt, f2: Pt, a: f64) -> Option<Ellipse> {
    let dx = f2.x - f1.x;
    let dz = f2.z - f1.z;
    let d = dx.hypot(dz);
    let c = d / 2.0;
    if !(a > c + 1e-6) {
        return None;
    }
    Some(Ellipse {
        ox: (f1.x + f2.x) / 2.0,
        oz: (f1.z + f2.z) / 2.0,
        a,
        b: (a * a - c * c).sqrt(),
        ux: if d > 1e-9 { dx / d } else { 1.0 },
        uz: if d > 1e-9 { dz / d } else { 0.0 },
    })
}

pub fn ellipse_samples(e: &Ellipse, t0: f64, t1: f64, n: usize) -> Vec<ConicSample> {
    let vx = -e.uz;
    let vz = e.ux;
    let mut out = Vec::with_capacity(n + 1);
    for k in 0..=n {
        let t = t0 + ((t1 - t0) * (k as f64)) / (n as f64);
        let ct = t.cos();
        let st = t.sin();
        let mut gx = ct / e.a;
        let mut gz = st / e.b;
        let gl = gx.hypot(gz).max(1e-9);
        gx /= gl;
        gz /= gl;
        out.push(ConicSample {
            x: e.ox + e.a * ct * e.ux + e.b * st * vx,
            z: e.oz + e.a * ct * e.uz + e.b * st * vz,
            nx: -(gx * e.ux + gz * vx),
            nz: -(gx * e.uz + gz * vz),
        });
    }
    out
}

pub fn parabola_samples(
    focus: Pt,
    axis: Pt,
    f: f64,
    u0: f64,
    u1: f64,
    n: usize,
    s0: f64,
) -> Vec<ConicSample> {
    let ax = axis.x;
    let az = axis.z;
    let px = -az;
    let pz = ax;
    let mut out = Vec::with_capacity(n + 1);
    let denom = if n > 0 { n as f64 } else { 1.0 };
    for k in 0..=n {
        let u = u0 + ((u1 - u0) * (k as f64)) / denom;
        let s = s0 - (u * u) / (4.0 * f);
        let ns: f64 = -1.0;
        let nu: f64 = -u / (2.0 * f);
        let nl = ns.hypot(nu).max(1e-9);
        let ns_norm = ns / nl;
        let nu_norm = nu / nl;
        out.push(ConicSample {
            x: focus.x + s * ax + u * px,
            z: focus.z + s * az + u * pz,
            nx: ns_norm * ax + nu_norm * px,
            nz: ns_norm * az + nu_norm * pz,
        });
    }

    out
}

#[derive(Debug, Clone)]
pub struct ParabolicJawsResult {
    pub left: Vec<ArcFeature>,
    pub right: Vec<ArcFeature>,
    pub curved_depth: f64,
    pub focus_ahead: f64,
}

pub fn parabolic_jaws(
    mouth: Pt,
    axis: Pt,
    w: f64,
    depth: f64,
    segments: usize,
    throat_deg: f64,
) -> ParabolicJawsResult {
    let t = ((throat_deg.clamp(1.0, 80.0) * PI) / 180.0).tan();
    let f = (w / 4.0) * t;
    let s0 = (w * w) / (16.0 * f);
    let u_throat = w / 2.0;
    let asked = (4.0 * f * (s0 + depth)).sqrt();
    let k_max = ((((MAX_ARC_RADIUS / (2.0 * f)).powi(2)).cbrt() - 1.0).max(0.0)).sqrt();
    let u_end = asked.min((u_throat * 1.02).max(2.0 * f * k_max));

    let mk = |a: f64, b: f64| -> Vec<ArcFeature> {
        let samples = parabola_samples(mouth, axis, f, a, b, segments, s0);
        arc_chain_from_samples(&samples, true, Some("funnel"))
    };


    ParabolicJawsResult {
        left: mk(-u_throat, -u_end),
        right: mk(u_throat, u_end),
        curved_depth: (u_end * u_end) / (4.0 * f) - s0,
        focus_ahead: s0 - f,
    }
}

pub fn gap_to_arc(f: &ArcFeature, x: f64, z: f64) -> f64 {
    (x - f.cx as f64).hypot(z - f.cz as f64) - f.r as f64
}

#[derive(Debug, Clone)]
pub struct NearestOnChainResult {
    pub gap: f64,
    pub nx: f64,
    pub nz: f64,
    pub feature: ArcFeature,
}

pub fn nearest_on_chain(chain: &[ArcFeature], x: f64, z: f64) -> Option<NearestOnChainResult> {
    let mut best: Option<NearestOnChainResult> = None;
    for f in chain {
        let dx = x - f.cx as f64;
        let dz = z - f.cz as f64;
        let d = dx.hypot(dz);
        if d < 1e-9 {
            continue;
        }
        let mut rel = ((dz.atan2(dx) - f.a0 as f64) % TAU + TAU) % TAU;
        if rel > TAU - 1e-9 {
            rel -= TAU;
        }
        if rel < -1e-9 || rel > f.span as f64 + 1e-9 {
            continue;
        }
        let sign = if f.solid_out { -1.0 } else { 1.0 };
        let gap = (d - f.r as f64).abs();
        if best.as_ref().map_or(true, |b| gap < b.gap) {
            best = Some(NearestOnChainResult {
                gap,
                nx: (sign * dx) / d,
                nz: (sign * dz) / d,
                feature: f.clone(),
            });

        }
    }
    best
}
