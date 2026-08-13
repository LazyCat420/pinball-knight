//! DOORWAY FUNNELS — flare a threshold so a ball banks THROUGH it, not off it.
//!
//! PORTS: `maze/doorway-funnels.ts`

use std::collections::{HashMap, HashSet};
use std::f64::consts::TAU;

use crate::flow_field::bfs_distances;
use crate::grid::{at, idx, is_walkable, set_shape, set_tile, shape_at, Grid, T_CRACKED, T_FLOOR, T_WALL};
use crate::maze::arc_contract::junction_clear;
use crate::maze::conic_fit::{parabolic_jaws, Pt, THROAT_ANGLE_DEG};
use crate::maze::doorways::Doorway;
use crate::tile_shape::{ArcFeature, LaneBand, SHAPE_ARC, SHAPE_FULL};

pub const FUNNEL_MAX_FEATURES: usize = 32;
pub const FUNNEL_MAX_DOORWAYS: usize = 4;
pub const FUNNEL_DEPTH: f64 = 4.0;
pub const FUNNEL_SEGMENTS: usize = 2;
pub const FUNNEL_THROAT_DEG: f64 = THROAT_ANGLE_DEG;
pub const FUNNEL_LANES: bool = true;
pub const THRESHOLD_KEEPOUT: f64 = 1.0;
pub const FUNNEL_BACKING: f64 = 2.0;
pub const FUNNEL_MAX_FILL: usize = 16;
pub const FUNNEL_FILL: bool = true;

#[derive(Debug, Clone)]
pub struct TilePos {
    pub i: i32,
    pub j: i32,
}

#[derive(Debug, Clone)]
pub struct TileSnapshot {
    pub k: usize,
    pub t: u8,
    pub shape: u8,
}

#[derive(Debug, Clone)]
pub struct JawPlan {
    pub features: Vec<ArcFeature>,
    pub arc_tiles: Vec<Vec<TilePos>>,
    pub carve_tiles: Vec<TilePos>,
    pub fill_tiles: Vec<TilePos>,
    pub mouth: Option<Pt>,
    pub before: Vec<TileSnapshot>,
}

fn tile_dist_range(cx: f64, cz: f64, ti: i32, tj: i32) -> (f64, f64) {
    let nx = (cx).clamp(ti as f64, (ti + 1) as f64);
    let nz = (cz).clamp(tj as f64, (tj + 1) as f64);
    let mut dmax: f64 = 0.0;
    for &px in &[ti as f64, (ti + 1) as f64] {
        for &pz in &[tj as f64, (tj + 1) as f64] {
            let d = (cx - px).hypot(cz - pz);
            if d > dmax {
                dmax = d;
            }
        }
    }
    ((cx - nx).hypot(cz - nz), dmax)
}

fn within_span(f: &ArcFeature, ti: i32, tj: i32) -> bool {
    let ang = ((tj as f64) + 0.5 - f.cz).atan2((ti as f64) + 0.5 - f.cx);
    let margin = 0.5 / f.r.max(1.0);
    let mut rel = (ang - (f.a0 - margin)) % TAU;
    if rel < 0.0 {
        rel += TAU;
    }
    rel <= f.span + 2.0 * margin
}

pub fn claimable<F: Fn(i32, i32) -> bool>(g: &Grid, ti: i32, tj: i32, occupied: &F) -> bool {
    if ti <= 0 || tj <= 0 || ti >= g.w - 1 || tj >= g.h - 1 {
        return false;
    }
    if at(g, ti, tj) != T_WALL {
        return false;
    }
    if shape_at(g, ti, tj) != SHAPE_FULL {
        return false;
    }
    !occupied(ti, tj)
}

fn fillable<F: Fn(i32, i32) -> bool>(g: &Grid, ti: i32, tj: i32, occupied: &F) -> bool {
    if ti <= 0 || tj <= 0 || ti >= g.w - 1 || tj >= g.h - 1 {
        return false;
    }
    if at(g, ti, tj) != T_FLOOR {
        return false;
    }
    if shape_at(g, ti, tj) != SHAPE_FULL {
        return false;
    }
    !occupied(ti, tj)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JawReject {
    Empty,
    Claimed,
    Unfillable,
    TooMuchFill,
    NoBacking,
    NoTiles,
    Junction,
}

pub fn plan_chain<F: Fn(i32, i32) -> bool, S: Fn(i32, i32) -> bool>(
    g: &Grid,
    chain: &[ArcFeature],
    occupied: &F,
    sealed: &S,
) -> Result<JawPlan, JawReject> {
    if chain.is_empty() {
        return Err(JawReject::Empty);
    }
    let mut arc_tiles = Vec::new();
    let mut features = Vec::new();
    let mut carve_tiles = Vec::new();
    let mut fill_tiles = Vec::new();
    let mut seen: HashSet<usize> = HashSet::new();

    for f in chain {
        let mut mine = Vec::new();
        let mut carve = Vec::new();
        let mut fill = Vec::new();
        let mut claimed_set: HashSet<usize> = HashSet::new();
        let mut ok = true;

        let i0 = (f.cx - f.r - 1.0).floor() as i32;
        let i1 = (f.cx + f.r + 1.0).ceil() as i32;
        let j0 = (f.cz - f.r - 1.0).floor() as i32;
        let j1 = (f.cz + f.r + 1.0).ceil() as i32;

        for tj in j0..=j1 {
            if !ok {
                break;
            }
            for ti in i0..=i1 {
                if !within_span(f, ti, tj) {
                    continue;
                }
                let (dmin, dmax) = tile_dist_range(f.cx, f.cz, ti, tj);
                let straddles = dmin < f.r - 1e-6 && dmax > f.r + 1e-6;
                let inside = dmax <= f.r + 1e-6;
                let outside = dmin >= f.r - 1e-6;
                let k = idx(g, ti, tj);

                if straddles {
                    if !claimable(g, ti, tj, occupied)
                        && !(FUNNEL_FILL && fillable(g, ti, tj, occupied))
                    {
                        ok = false;
                        break;
                    }
                    if seen.contains(&k) || !claimed_set.insert(k) {
                        continue;
                    }
                    if is_walkable(g, ti, tj) {
                        fill.push(TilePos { i: ti, j: tj });
                    }
                    mine.push(TilePos { i: ti, j: tj });
                } else if inside {
                    if is_walkable(g, ti, tj) {
                        continue;
                    }
                    if sealed(ti, tj) {
                        ok = false;
                        break;
                    }
                    if !claimable(g, ti, tj, occupied) {
                        ok = false;
                        break;
                    }
                    if seen.contains(&k) || !claimed_set.insert(k) {
                        continue;
                    }
                    carve.push(TilePos { i: ti, j: tj });
                } else if outside && dmin < f.r + FUNNEL_BACKING {
                    if !is_walkable(g, ti, tj) {
                        continue;
                    }
                    if !FUNNEL_FILL || at(g, ti, tj) == T_CRACKED || !fillable(g, ti, tj, occupied) {
                        ok = false;
                        break;
                    }
                    if seen.contains(&k) || !claimed_set.insert(k) {
                        continue;
                    }
                    fill.push(TilePos { i: ti, j: tj });
                }
            }
        }

        if !ok || mine.is_empty() {
            break;
        }
        if fill_tiles.len() + fill.len() > FUNNEL_MAX_FILL {
            break;
        }

        for t in &mine {
            seen.insert(idx(g, t.i, t.j));
        }
        for t in &carve {
            seen.insert(idx(g, t.i, t.j));
        }
        for t in &fill {
            seen.insert(idx(g, t.i, t.j));
        }
        features.push(f.clone());
        arc_tiles.push(mine);
        carve_tiles.extend(carve);
        fill_tiles.extend(fill);
    }

    if features.is_empty() {
        return Err(JawReject::Claimed);
    }
    Ok(JawPlan {
        features,
        arc_tiles,
        carve_tiles,
        fill_tiles,
        mouth: None,
        before: Vec::new(),
    })
}

pub fn lane_toward_mouth(f: &ArcFeature, mouth: Pt) -> LaneBand {
    let mid = f.a0 + f.span / 2.0;
    let px = f.cx + mid.cos() * f.r;
    let pz = f.cz + mid.sin() * f.r;
    let dx = px - f.cx;
    let dz = pz - f.cz;
    let d = dx.hypot(dz).max(1e-9);
    let tx = -dz / d;
    let tz = dx / d;
    let cw = tx * (mouth.x - px) + tz * (mouth.z - pz) > 0.0;
    LaneBand {
        a0: f.a0,
        span: f.span,
        cw,
        cooldown_t: 0.0,
        hit_t: -1.0,
    }
}

pub fn commit_jaw(g: &mut Grid, plan: &mut JawPlan) -> usize {
    if g.arc_idx.is_none() {
        g.arc_idx = Some(vec![-1i16; (g.w * g.h) as usize]);
    }

    let mut note = |ti: i32, tj: i32, before: &mut Vec<TileSnapshot>| {
        let k = idx(g, ti, tj);
        if before.iter().any(|b| b.k == k) {
            return;
        }
        before.push(TileSnapshot {
            k,
            t: at(g, ti, tj),
            shape: shape_at(g, ti, tj),
        });
    };

    for t in &plan.carve_tiles {
        note(t.i, t.j, &mut plan.before);
    }
    for t in &plan.fill_tiles {
        note(t.i, t.j, &mut plan.before);
    }
    for list in &plan.arc_tiles {
        for t in list {
            note(t.i, t.j, &mut plan.before);
        }
    }

    for t in &plan.carve_tiles {
        set_tile(g, t.i, t.j, T_FLOOR);
    }
    for t in &plan.fill_tiles {
        set_tile(g, t.i, t.j, T_WALL);
    }

    for (k, f_orig) in plan.features.iter().enumerate() {
        let mut f = f_orig.clone();
        let fi = g.arcs.len();
        if FUNNEL_LANES {
            if let Some(mouth) = plan.mouth {
                f.lanes = vec![lane_toward_mouth(&f, mouth)];
            }
        }
        g.arcs.push(f);
        for t in &plan.arc_tiles[k] {
            set_tile(g, t.i, t.j, T_WALL);
            set_shape(g, t.i, t.j, SHAPE_ARC);
            let kidx = idx(g, t.i, t.j);
            if let Some(ref mut arc_idx) = g.arc_idx {
                arc_idx[kidx] = fi as i16;
            }
        }
    }

    plan.features.len()
}


pub fn revert_jaw(g: &mut Grid, plan: &mut JawPlan) {
    for f in &mut plan.features {
        f.kicks.clear();
        f.lanes.clear();
    }
    for b in &plan.before {
        let i = (b.k as i32) % g.w;
        let j = (b.k as i32) / g.w;
        set_tile(g, i, j, b.t);
        set_shape(g, i, j, b.shape);
        if let Some(ref mut arc_idx) = g.arc_idx {
            arc_idx[b.k] = -1;
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct FunnelReport {
    pub doorways: usize,
    pub jaws: usize,
    pub features: usize,
    pub carved: usize,
    pub filled: usize,
    pub reverted: usize,
    pub rejects: HashMap<&'static str, usize>,
}

pub fn author_doorway_funnels<F: Fn(i32, i32) -> bool>(
    g: &mut Grid,
    doorways: &[Doorway],
    start: (i32, i32),
    occupied: F,
    tune_throat_deg: Option<f64>,
    tune_depth: Option<f64>,
    tune_segments: Option<usize>,
) -> FunnelReport {
    let mut report = FunnelReport::default();
    if doorways.is_empty() {
        return report;
    }
    if g.arc_idx.is_none() {
        g.arc_idx = Some(vec![-1i16; (g.w * g.h) as usize]);
    }

    let mut committed: Vec<JawPlan> = Vec::new();
    let mut order = doorways.to_vec();
    order.sort_by(|a, b| {
        a.w.cmp(&b.w)
            .then_with(|| a.site.i.cmp(&b.site.i))
            .then_with(|| a.site.j.cmp(&b.site.j))
    });
    let mut built = 0;

    for d in &order {
        if report.doorways >= FUNNEL_MAX_DOORWAYS || built >= FUNNEL_MAX_FEATURES {
            break;
        }
        let focus = Pt {
            x: (d.site.i as f64) + 0.5,
            z: (d.site.j as f64) + 0.5,
        };
        let sealed = |i: i32, j: i32| -> bool {
            ((i - d.site.i) * d.site.ai + (j - d.site.j) * d.site.aj).abs() as f64 <= THRESHOLD_KEEPOUT
        };
        let mut jaws_here = 0;

        for &dir in &[1, -1] {
            let axis = Pt {
                x: (d.site.ai * dir) as f64,
                z: (d.site.aj * dir) as f64,
            };
            let jaws = parabolic_jaws(
                focus,
                axis,
                d.w as f64,
                tune_depth.unwrap_or(FUNNEL_DEPTH),
                tune_segments.unwrap_or(FUNNEL_SEGMENTS),
                tune_throat_deg.unwrap_or(FUNNEL_THROAT_DEG),
            );

            let mut pair: Vec<JawPlan> = Vec::new();
            let mut arms_ok = true;

            for chain in &[jaws.left, jaws.right] {
                let plan = plan_chain(g, chain, &occupied, &sealed);
                let Ok(mut plan) = plan else {
                    let reject_key = match plan.unwrap_err() {
                        JawReject::Empty => "empty",
                        JawReject::Claimed => "claimed",
                        JawReject::Unfillable => "unfillable",
                        JawReject::TooMuchFill => "too-much-fill",
                        JawReject::NoBacking => "no-backing",
                        JawReject::NoTiles => "no-tiles",
                        JawReject::Junction => "junction",
                    };
                    *report.rejects.entry(reject_key).or_insert(0) += 1;
                    arms_ok = false;
                    break;
                };

                let junction_ok = plan.features.iter().enumerate().all(|(k, f)| {
                    let tile_coords: Vec<(i32, i32)> = plan.arc_tiles[k].iter().map(|t| (t.i, t.j)).collect();
                    junction_clear(g, &tile_coords, f)
                });
                if !junction_ok {
                    *report.rejects.entry("junction").or_insert(0) += 1;
                    arms_ok = false;
                    break;
                }
                plan.mouth = Some(focus);
                pair.push(plan);
            }

            let cost: usize = pair.iter().map(|p| p.features.len()).sum();
            if !arms_ok || pair.len() != 2 || built + cost > FUNNEL_MAX_FEATURES {
                continue;
            }

            for mut plan in pair {
                built += commit_jaw(g, &mut plan);
                report.jaws += 1;
                report.carved += plan.carve_tiles.len();
                report.filled += plan.fill_tiles.len();
                committed.push(plan);
                jaws_here += 1;
            }
        }
        if jaws_here > 0 {
            report.doorways += 1;
        }
    }

    let is_stranded = |g: &Grid| -> bool {
        let d = bfs_distances(g, start.0, start.1);
        for j in 0..g.h {
            for i in 0..g.w {
                if is_walkable(g, i, j) && d[idx(g, i, j)] < 0 {
                    return true;
                }
            }
        }
        false
    };

    while !committed.is_empty() && is_stranded(g) {
        let mut p = committed.pop().unwrap();
        let feat_count = p.features.len();
        let carve_count = p.carve_tiles.len();
        let fill_count = p.fill_tiles.len();
        revert_jaw(g, &mut p);
        built -= feat_count;
        report.reverted += feat_count;
        report.jaws = report.jaws.saturating_sub(1);
        report.carved = report.carved.saturating_sub(carve_count);
        report.filled = report.filled.saturating_sub(fill_count);
    }
    report.doorways = report.doorways.min(report.jaws);
    report.features = built;
    report
}
