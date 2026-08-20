//! Relay Chambers — two-focus ellipse bank arcs connecting room doorway mouths.
//!
//! PORTS: `maze/relay-chambers.ts`

use std::collections::HashMap;
use std::f64::consts::PI;

use crate::flow_field::bfs_distances;
use crate::grid::{ensure_arcs, idx, is_walkable, Grid};
use crate::maze::arc_contract::junction_clear;
use crate::maze::conic_fit::{arc_chain_from_samples, ellipse_from_foci, ellipse_samples, Pt};
use crate::maze::doorway_funnels::{
    commit_jaw, lane_toward_mouth, plan_chain, revert_jaw, JawPlan,
};
use crate::maze::doorways::Doorway;
use crate::maze::track_launch::TilePos;
use crate::tile_shape::ArcFeature;

pub const RELAY_STANDOFF: f64 = 1.6;
pub const RELAY_MIN_SPAN: f64 = 5.0;
pub const RELAY_MAX_SPAN: f64 = 26.0;
pub const RELAY_SEGMENTS: usize = 5;
pub const RELAY_MAX_PER_FLOOR: usize = 3;

#[derive(Debug, Clone, Default)]
pub struct RelayTune {
    pub standoff: Option<f64>,
    pub segments: Option<usize>,
    pub max_per_floor: Option<usize>,
}

#[derive(Debug, Clone, Default)]
pub struct RelayReport {
    pub chambers: usize,
    pub features: usize,
    pub carved: usize,
    pub filled: usize,
    pub reverted: usize,
    pub rejects: HashMap<String, usize>,
}

fn mouth(d: &Doorway) -> Pt {
    Pt {
        x: d.site.i as f64 + 0.5,
        z: d.site.j as f64 + 0.5,
    }
}

pub fn author_relay_chambers<F: Fn(i32, i32) -> bool>(
    g: &mut Grid,
    doorways: &[Doorway],
    start: TilePos,
    occupied: F,
    tune: &RelayTune,
) -> RelayReport {
    let mut report = RelayReport::default();
    if doorways.len() < 2 {
        return report;
    }
    ensure_arcs(g);

    let standoff = tune.standoff.unwrap_or(RELAY_STANDOFF);
    let segments = tune.segments.unwrap_or(RELAY_SEGMENTS);
    let cap = tune.max_per_floor.unwrap_or(RELAY_MAX_PER_FLOOR);

    struct Pair<'a> {
        a: &'a Doorway,
        b: &'a Doorway,
        span: f64,
    }

    let mut pairs = Vec::new();
    for i in 0..doorways.len() {
        for j in (i + 1)..doorways.len() {
            let a = &doorways[i];
            let b = &doorways[j];
            let shares = a.site.a == b.site.a
                || a.site.a == b.site.b
                || a.site.b == b.site.a
                || a.site.b == b.site.b;
            if !shares {
                continue;
            }
            let span = ((a.site.i - b.site.i) as f64).hypot((a.site.j - b.site.j) as f64);
            if span < RELAY_MIN_SPAN || span > RELAY_MAX_SPAN {
                continue;
            }
            pairs.push(Pair { a, b, span });
        }
    }

    pairs.sort_by(|p, q| {
        q.span
            .partial_cmp(&p.span)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| p.a.site.i.cmp(&q.a.site.i))
            .then_with(|| p.a.site.j.cmp(&q.a.site.j))
    });

    let mut committed: Vec<JawPlan> = Vec::new();
    let mut built = 0;

    for pair in pairs {
        if report.chambers >= cap {
            break;
        }
        let f1 = mouth(pair.a);
        let f2 = mouth(pair.b);
        let c = (f2.x - f1.x).hypot(f2.z - f1.z) / 2.0;
        let e = ellipse_from_foci(f1, f2, c + standoff);
        let Some(e) = e else {
            continue;
        };

        let mut halves = 0;
        for (t0, t1) in [(0.12, PI - 0.12), (PI + 0.12, 2.0 * PI - 0.12)] {
            let chain = arc_chain_from_samples(&ellipse_samples(&e, t0, t1, segments), true, Some("funnel"));
            if chain.is_empty() {
                continue;
            }
            let plan = plan_chain(g, &chain, &occupied, &|_, _| false);
            let Ok(mut plan) = plan else {
                if let Err(rej) = plan {
                    *report.rejects.entry(format!("{rej:?}")).or_insert(0) += 1;
                }
                continue;
            };

            let all_clear = plan.features.iter().enumerate().all(|(k, f)| {
                let coords: Vec<(i32, i32)> = plan.arc_tiles[k].iter().map(|t| (t.i, t.j)).collect();
                junction_clear(g, &coords, f)
            });
            if !all_clear {
                *report.rejects.entry("junction".to_string()).or_insert(0) += 1;
                continue;
            }

            plan.mouth = None;
            for f in &mut plan.features {
                let mid = f.a0 + f.span / 2.0;
                let px = f.cx + mid.cos() * f.r;
                let pz = f.cz + mid.sin() * f.r;
                let near = if (px - f1.x).hypot(pz - f1.z) <= (px - f2.x).hypot(pz - f2.z) {
                    f2
                } else {
                    f1
                };
                f.lanes = vec![lane_toward_mouth(f, near)];
            }
            built += commit_jaw(g, &mut plan);
            report.carved += plan.carve_tiles.len();
            report.filled += plan.fill_tiles.len();
            committed.push(plan);
            halves += 1;
        }
        if halves > 0 {
            report.chambers += 1;
        }
    }

    let stranded = |grid: &Grid| -> bool {
        let d = bfs_distances(grid, start.i, start.j);
        for j in 0..grid.h {
            for i in 0..grid.w {
                if is_walkable(grid, i, j) && d[idx(grid, i, j)] < 0 {
                    return true;
                }
            }
        }
        false
    };

    while !committed.is_empty() && stranded(g) {
        let mut p = committed.pop().unwrap();
        revert_jaw(g, &mut p);
        built -= p.features.len();
        report.reverted += p.features.len();
        report.carved -= p.carve_tiles.len();
        report.filled -= p.fill_tiles.len();
    }
    report.features = built;
    report
}

pub fn relay_ellipse(a: &Doorway, b: &Doorway, standoff: f64) -> Vec<ArcFeature> {
    let f1 = mouth(a);
    let f2 = mouth(b);
    let c = (f2.x - f1.x).hypot(f2.z - f1.z) / 2.0;
    let e = ellipse_from_foci(f1, f2, c + standoff);
    let Some(e) = e else {
        return Vec::new();
    };
    arc_chain_from_samples(&ellipse_samples(&e, 0.12, PI - 0.12, RELAY_SEGMENTS), true, Some("funnel"))
}

#[derive(Debug, Clone, PartialEq)]
pub struct RelayEllipse {
    pub f1: (f64, f64),
    pub f2: (f64, f64),
    pub center: (f64, f64),
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub angle: f64,
}

impl RelayEllipse {
    pub fn point_at(&self, theta: f64) -> (f64, f64) {
        let x_local = self.a * theta.cos();
        let y_local = self.b * theta.sin();

        let cos_a = self.angle.cos();
        let sin_a = self.angle.sin();

        let wx = self.center.0 + x_local * cos_a - y_local * sin_a;
        let wz = self.center.1 + x_local * sin_a + y_local * cos_a;

        (wx, wz)
    }

    pub fn normal_at(&self, theta: f64) -> (f64, f64) {
        let nx_local = theta.cos() / self.a;
        let ny_local = theta.sin() / self.b;
        let len = (nx_local * nx_local + ny_local * ny_local).sqrt();
        let (nx_unit, ny_unit) = (nx_local / len, ny_local / len);

        let cos_a = self.angle.cos();
        let sin_a = self.angle.sin();

        let wx = nx_unit * cos_a - ny_unit * sin_a;
        let wz = nx_unit * sin_a + ny_unit * cos_a;

        (wx, wz)
    }
}

pub fn compute_relay_ellipse(
    d1: (f64, f64),
    d2: (f64, f64),
    standoff: f64,
) -> Option<RelayEllipse> {
    let dx = d2.0 - d1.0;
    let dz = d2.1 - d1.1;
    let focal_dist = dx.hypot(dz);
    let c = focal_dist * 0.5;

    if standoff <= 0.0 {
        return None;
    }

    let a = c + standoff;
    let b = (a * a - c * c).sqrt();
    let center = ((d1.0 + d2.0) * 0.5, (d1.1 + d2.1) * 0.5);
    let angle = dz.atan2(dx);

    Some(RelayEllipse {
        f1: d1,
        f2: d2,
        center,
        a,
        b,
        c,
        angle,
    })
}

pub fn sample_relay_arc(
    ellipse: &RelayEllipse,
    theta_start: f64,
    theta_end: f64,
    num_samples: usize,
) -> Vec<(f64, f64)> {
    if num_samples < 2 {
        return Vec::new();
    }

    let mut samples = Vec::with_capacity(num_samples);
    let step = (theta_end - theta_start) / (num_samples - 1) as f64;

    for i in 0..num_samples {
        let theta = theta_start + step * i as f64;
        samples.push(ellipse.point_at(theta));
    }

    samples
}
