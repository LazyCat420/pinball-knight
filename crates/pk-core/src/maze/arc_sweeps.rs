//! ARC SWEEPS — multi-tile curved walls, the pinball-table "ball guides".
//!
//! PORTS: `maze/arc-sweeps.ts`

use std::f64::consts::{FRAC_PI_2, PI, TAU};

use crate::flow_field::bfs_distances;
use crate::grid::{
    at, ensure_arcs, idx, is_walkable, set_shape, set_tile, shape_at, Grid, T_CRACKED, T_FLOOR,
    T_WALL,
};
use crate::maze::arc_contract::junction_clear;
use crate::maze::flow_orient::{flow_drop, is_downhill, open_runway, phi_at, TilePos};
use crate::maze::CountingRng;
use crate::tile_shape::{ArcFeature, KickBand, LaneBand, SHAPE_ARC, SHAPE_FULL};

pub const FILLET_RADII: [i32; 2] = [3, 2];
pub const MAX_SWEEPS_PER_FLOOR: usize = 96;
pub const ORBIT_RADIUS: f64 = 2.3;
pub const ORBIT_RING: f64 = 1.6;

pub const KICK_CHANCE: f64 = 0.22;
pub const KICK_BAND_FRAC: f64 = 0.62;
pub const KICK_ISLAND_BANDS: usize = 3;
pub const KICK_ISLAND_SPAN: f64 = 0.62;
pub const KICK_MAX_PER_FLOOR: usize = 6;
pub const KICK_MIN_SPAN: f64 = 0.9;

pub const LANE_CHANCE: f64 = 0.92;
pub const LANE_BAND_FRAC: f64 = 0.94;
pub const LANE_MAX_PER_FLOOR: usize = 16;
pub const LANE_MIN_SPAN: f64 = 0.9;

pub const RAIL_RIDE_INSET: f64 = 0.3;
pub const RAIL_MIN_RUNWAY: usize = 5;
const RAIL_EXIT_STEP: f64 = 1.0;
const RAIL_EXIT_MAX: f64 = 2.0;

fn centred_band(a0: f64, total: f64, frac: f64) -> KickBand {
    let span = total * frac;
    KickBand {
        a0: a0 + (total - span) / 2.0,
        span,
        cooldown_t: 0.0,
        hit_t: -1.0,
    }
}

fn centred_lane(a0: f64, total: f64, frac: f64, cw: bool) -> LaneBand {
    let span = total * frac;
    LaneBand {
        a0: a0 + (total - span) / 2.0,
        span,
        cw,
        cooldown_t: 0.0,
        hit_t: -1.0,
    }
}

pub fn quadrant_a0(cx: i32, cz: i32) -> f64 {
    if cx > 0 && cz < 0 {
        -FRAC_PI_2 // NE
    } else if cx > 0 && cz > 0 {
        0.0 // SE
    } else if cx < 0 && cz > 0 {
        FRAC_PI_2 // SW
    } else {
        PI // NW
    }
}

pub fn tile_dist_range(cx: f64, cz: f64, ti: i32, tj: i32) -> (f64, f64) {
    let t_fx = ti as f64;
    let t_fz = tj as f64;
    let nx = cx.clamp(t_fx, t_fx + 1.0);
    let nz = cz.clamp(t_fz, t_fz + 1.0);
    let dmin = (cx - nx).hypot(cz - nz);
    let mut dmax = 0.0_f64;
    for px in [t_fx, t_fx + 1.0] {
        for pz in [t_fz, t_fz + 1.0] {
            let d = (cx - px).hypot(cz - pz);
            if d > dmax {
                dmax = d;
            }
        }
    }
    (dmin, dmax)
}

#[derive(Clone, Debug)]
pub struct FilletPlan {
    pub feature: ArcFeature,
    pub arc_tiles: Vec<TilePos>,
    pub carve_tiles: Vec<TilePos>,
    pub fill_tiles: Vec<TilePos>,
}

pub fn plan_fillet<F: Fn(i32, i32) -> bool>(
    g: &Grid,
    px: i32,
    pz: i32,
    cx: i32,
    cz: i32,
    r: i32,
    concave: bool,
    occupied: &F,
) -> Option<FilletPlan> {
    let x0 = if cx > 0 { px - r } else { px };
    let x1 = if cx > 0 { px - 1 } else { px + r - 1 };
    let z0 = if cz > 0 { pz - r } else { pz };
    let z1 = if cz > 0 { pz - 1 } else { pz + r - 1 };
    if x0 <= 0 || z0 <= 0 || x1 >= g.w - 1 || z1 >= g.h - 1 {
        return None;
    }

    let c_x = (px - cx * r) as f64;
    let c_z = (pz - cz * r) as f64;
    let r_f = r as f64;
    let mut arc_tiles = Vec::new();
    let mut carve_tiles = Vec::new();
    let mut fill_tiles = Vec::new();

    for tj in z0..=z1 {
        for ti in x0..=x1 {
            let t = at(g, ti, tj);
            if shape_at(g, ti, tj) != SHAPE_FULL {
                return None;
            }
            if occupied(ti, tj) {
                return None;
            }
            let (dmin, dmax) = tile_dist_range(c_x, c_z, ti, tj);
            let inside = dmax <= r_f + 1e-6;
            let outside = dmin >= r_f - 1e-6;

            if concave {
                if t != T_FLOOR {
                    return None;
                }
                if outside {
                    fill_tiles.push(TilePos { i: ti, j: tj });
                } else if !inside {
                    arc_tiles.push(TilePos { i: ti, j: tj });
                }
            } else {
                if t != T_WALL {
                    return None;
                }
                if outside {
                    for dj in -1..=1 {
                        for di in -1..=1 {
                            if shape_at(g, ti + di, tj + dj) == SHAPE_ARC {
                                return None;
                            }
                        }
                    }
                    carve_tiles.push(TilePos { i: ti, j: tj });
                } else if !inside {
                    arc_tiles.push(TilePos { i: ti, j: tj });
                }
            }
        }
    }

    if arc_tiles.is_empty() {
        return None;
    }

    let solid_face = |g: &Grid, i: i32, j: i32| -> bool {
        !is_walkable(g, i, j) && at(g, i, j) != T_CRACKED && shape_at(g, i, j) == SHAPE_FULL
    };
    let z_face_row = if cz > 0 { z1 } else { z0 };
    let x_face_col = if cx > 0 { x1 } else { x0 };
    let cont_x = if cx > 0 { x0 - 1 } else { x1 + 1 };
    let cont_z = if cz > 0 { z0 - 1 } else { z1 + 1 };

    if concave {
        let wall_row_z = if cz > 0 { z1 + 1 } else { z0 - 1 };
        let wall_col_x = if cx > 0 { x1 + 1 } else { x0 - 1 };
        for ti in x0..=x1 {
            if !solid_face(g, ti, wall_row_z) {
                return None;
            }
        }
        for tj in z0..=z1 {
            if !solid_face(g, wall_col_x, tj) {
                return None;
            }
        }
        if !solid_face(g, cont_x, wall_row_z) || !solid_face(g, wall_col_x, cont_z) {
            return None;
        }

        let open_row_z = if cz > 0 { z0 - 1 } else { z1 + 1 };
        let open_col_x = if cx > 0 { x0 - 1 } else { x1 + 1 };
        for ti in x0..=x1 {
            if at(g, ti, open_row_z) != T_FLOOR {
                return None;
            }
        }
        for tj in z0..=z1 {
            if at(g, open_col_x, tj) != T_FLOOR {
                return None;
            }
        }
    } else {
        if !solid_face(g, cont_x, z_face_row) || !solid_face(g, x_face_col, cont_z) {
            return None;
        }
        let floor_row_z = if cz > 0 { z1 + 1 } else { z0 - 1 };
        let floor_col_x = if cx > 0 { x1 + 1 } else { x0 - 1 };
        for ti in x0..=x1 {
            if at(g, ti, floor_row_z) != T_FLOOR {
                return None;
            }
        }
        for tj in z0..=z1 {
            if at(g, floor_col_x, tj) != T_FLOOR {
                return None;
            }
        }
    }

    let feature = ArcFeature {
        cx: c_x,
        cz: c_z,
        r: r_f,
        a0: quadrant_a0(cx, cz),
        span: FRAC_PI_2,
        kicks: Vec::new(),
        lanes: Vec::new(),
        solid_out: concave,
        owner: Some("sweep"),
    };

    let arc_coords: Vec<(i32, i32)> = arc_tiles.iter().map(|t| (t.i, t.j)).collect();
    if !junction_clear(g, &arc_coords, &feature) {
        return None;
    }

    Some(FilletPlan {
        feature,
        arc_tiles,
        carve_tiles,
        fill_tiles,
    })
}

pub fn commit_fillet(g: &mut Grid, plan: &FilletPlan) {
    ensure_arcs(g);
    let fi = g.arcs.len() as i16;
    g.arcs.push(plan.feature.clone());
    for t in &plan.carve_tiles {
        set_tile(g, t.i, t.j, T_FLOOR);
    }
    for t in &plan.fill_tiles {
        set_tile(g, t.i, t.j, T_WALL);
    }
    for t in &plan.arc_tiles {
        let k = idx(g, t.i, t.j);
        set_tile(g, t.i, t.j, T_WALL);
        set_shape(g, t.i, t.j, SHAPE_ARC);
        if let Some(arr) = g.arc_idx.as_mut() {
            arr[k] = fi;
        }
    }
}

pub fn revert_concave(g: &mut Grid, plan: &mut FilletPlan) {
    plan.feature.kicks.clear();
    plan.feature.lanes.clear();
    for t in &plan.fill_tiles {
        set_tile(g, t.i, t.j, T_FLOOR);
    }
    for t in &plan.arc_tiles {
        let k = idx(g, t.i, t.j);
        set_tile(g, t.i, t.j, T_FLOOR);
        set_shape(g, t.i, t.j, SHAPE_FULL);
        if let Some(arr) = g.arc_idx.as_mut() {
            arr[k] = -1;
        }
    }
}

pub fn author_arc_sweeps<F: Fn(i32, i32) -> bool>(
    g: &mut Grid,
    start: TilePos,
    occupied: &F,
    rng: &mut CountingRng,
) -> usize {
    ensure_arcs(g);
    let mut count = g.arcs.len();
    let mut kickers = g.arcs.iter().map(|f| f.kicks.len()).sum::<usize>();
    let mut lanes = g.arcs.iter().map(|f| f.lanes.len()).sum::<usize>();
    let mut concave_plans = Vec::new();

    for j in 1..(g.h - 1) {
        if count >= MAX_SWEEPS_PER_FLOOR {
            break;
        }
        for i in 1..(g.w - 1) {
            if count >= MAX_SWEEPS_PER_FLOOR {
                break;
            }
            let is_wall_tile = at(g, i, j) == T_WALL && shape_at(g, i, j) == SHAPE_FULL;
            let is_floor_tile = at(g, i, j) == T_FLOOR;
            if !is_wall_tile && !is_floor_tile {
                continue;
            }

            let north = is_walkable(g, i, j - 1);
            let south = is_walkable(g, i, j + 1);
            let east = is_walkable(g, i + 1, j);
            let west = is_walkable(g, i - 1, j);

            let mut cx = 0;
            let mut cz = 0;
            let mut concave = false;

            if is_wall_tile {
                if north && east && is_walkable(g, i + 1, j - 1) && !south && !west {
                    cx = 1;
                    cz = -1;
                } else if north && west && is_walkable(g, i - 1, j - 1) && !south && !east {
                    cx = -1;
                    cz = -1;
                } else if south && east && is_walkable(g, i + 1, j + 1) && !north && !west {
                    cx = 1;
                    cz = 1;
                } else if south && west && is_walkable(g, i - 1, j + 1) && !north && !east {
                    cx = -1;
                    cz = 1;
                }
            } else {
                concave = true;
                if !north
                    && !east
                    && !is_walkable(g, i + 1, j - 1)
                    && south
                    && west
                    && is_walkable(g, i - 1, j + 1)
                {
                    cx = 1;
                    cz = -1;
                } else if !north
                    && !west
                    && !is_walkable(g, i - 1, j - 1)
                    && south
                    && east
                    && is_walkable(g, i + 1, j + 1)
                {
                    cx = -1;
                    cz = -1;
                } else if !south
                    && !east
                    && !is_walkable(g, i + 1, j + 1)
                    && north
                    && west
                    && is_walkable(g, i - 1, j - 1)
                {
                    cx = 1;
                    cz = 1;
                } else if !south
                    && !west
                    && !is_walkable(g, i - 1, j + 1)
                    && north
                    && east
                    && is_walkable(g, i + 1, j - 1)
                {
                    cx = -1;
                    cz = 1;
                }
            }

            if cx == 0 {
                continue;
            }

            let px = i + if cx > 0 { 1 } else { 0 };
            let pz = j + if cz > 0 { 1 } else { 0 };

            for &r in &FILLET_RADII {
                let Some(mut plan) = plan_fillet(g, px, pz, cx, cz, r, concave, occupied) else {
                    continue;
                };

                if !concave
                    && kickers < KICK_MAX_PER_FLOOR
                    && plan.feature.span >= KICK_MIN_SPAN
                    && rng.next_f64() < KICK_CHANCE
                {
                    plan.feature.kicks = vec![centred_band(
                        plan.feature.a0,
                        plan.feature.span,
                        KICK_BAND_FRAC,
                    )];
                    kickers += 1;
                }

                if concave
                    && lanes < LANE_MAX_PER_FLOOR
                    && plan.feature.span >= LANE_MIN_SPAN
                    && rng.next_f64() < LANE_CHANCE
                {
                    let cw = rng.next_f64() < 0.5;
                    plan.feature.lanes = vec![centred_lane(
                        plan.feature.a0,
                        plan.feature.span,
                        LANE_BAND_FRAC,
                        cw,
                    )];
                    lanes += 1;
                }

                commit_fillet(g, &plan);
                if concave {
                    concave_plans.push(plan);
                }
                count += 1;
                break;
            }
        }
    }

    if !concave_plans.is_empty() {
        let d = bfs_distances(g, start.i, start.j);
        let mut stranded = false;
        for j in 0..g.h {
            if stranded {
                break;
            }
            for i in 0..g.w {
                if is_walkable(g, i, j) && d[idx(g, i, j)] < 0 {
                    stranded = true;
                    break;
                }
            }
        }
        if stranded {
            for plan in &mut concave_plans {
                revert_concave(g, plan);
            }
            count -= concave_plans.len();
        }
    }

    count
}

#[derive(Clone, Debug, PartialEq)]
pub struct OrbitSite {
    pub ci: i32,
    pub cj: i32,
}

pub fn stamp_orbit_island<F: Fn(i32, i32) -> bool>(
    g: &mut Grid,
    start: TilePos,
    occupied: &F,
    rng: &mut CountingRng,
) -> Option<OrbitSite> {
    ensure_arcs(g);
    let r = ORBIT_RADIUS;
    let need = r + ORBIT_RING;
    let mut candidates = Vec::new();
    let m = need.ceil() as i32 + 1;

    let mut cj = m;
    while cj < g.h - m {
        let mut ci = m;
        while ci < g.w - m {
            let mut ok = true;
            let c_xf = ci as f64;
            let c_zf = cj as f64;
            let tj_min = (c_zf - need).floor() as i32;
            let tj_max = (c_zf + need).ceil() as i32 - 1;
            let ti_min = (c_xf - need).floor() as i32;
            let ti_max = (c_xf + need).ceil() as i32 - 1;

            'scan: for tj in tj_min..=tj_max {
                for ti in ti_min..=ti_max {
                    let (dmin, _) = tile_dist_range(c_xf, c_zf, ti, tj);
                    if dmin >= need {
                        continue;
                    }
                    let converts = dmin < r + 0.8;
                    if at(g, ti, tj) != T_FLOOR
                        || shape_at(g, ti, tj) != SHAPE_FULL
                        || (converts && occupied(ti, tj))
                    {
                        ok = false;
                        break 'scan;
                    }
                }
            }
            if ok {
                candidates.push(OrbitSite { ci, cj });
            }
            ci += 2;
        }
        cj += 2;
    }

    if candidates.is_empty() {
        return None;
    }

    let pick_idx = (rng.next_f64() * candidates.len() as f64).floor() as usize;
    let site = candidates[pick_idx.min(candidates.len() - 1)].clone();

    let fi = g.arcs.len() as i16;
    let mut changed = Vec::new();
    let c_xf = site.ci as f64;
    let c_zf = site.cj as f64;
    let tj_min = (c_zf - r).floor() as i32 - 1;
    let tj_max = (c_zf + r).ceil() as i32;
    let ti_min = (c_xf - r).floor() as i32 - 1;
    let ti_max = (c_xf + r).ceil() as i32;

    for tj in tj_min..=tj_max {
        for ti in ti_min..=ti_max {
            let (dmin, dmax) = tile_dist_range(c_xf, c_zf, ti, tj);
            if dmin >= r - 1e-6 {
                continue;
            }
            let arc = dmax > r + 1e-6;
            let k = idx(g, ti, tj);
            set_tile(g, ti, tj, T_WALL);
            if arc {
                set_shape(g, ti, tj, SHAPE_ARC);
                if let Some(arr) = g.arc_idx.as_mut() {
                    arr[k] = fi;
                }
            }
            changed.push((ti, tj, arc));
        }
    }

    if changed.is_empty() {
        return None;
    }

    let phase = rng.next_f64() * TAU;
    let mut kicks = Vec::with_capacity(KICK_ISLAND_BANDS);
    for k in 0..KICK_ISLAND_BANDS {
        kicks.push(KickBand {
            a0: phase + (k as f64 * TAU) / KICK_ISLAND_BANDS as f64,
            span: KICK_ISLAND_SPAN,
            cooldown_t: 0.0,
            hit_t: -1.0,
        });
    }

    g.arcs.push(ArcFeature {
        cx: c_xf,
        cz: c_zf,
        r,
        a0: 0.0,
        span: TAU,
        kicks,
        lanes: Vec::new(),
        solid_out: false,
        owner: Some("island"),
    });

    let d = bfs_distances(g, start.i, start.j);
    for j in 0..g.h {
        for i in 0..g.w {
            if is_walkable(g, i, j) && d[idx(g, i, j)] < 0 {
                for (ti, tj, arc) in changed {
                    let k = idx(g, ti, tj);
                    set_tile(g, ti, tj, T_FLOOR);
                    if arc {
                        set_shape(g, ti, tj, SHAPE_FULL);
                        if let Some(arr) = g.arc_idx.as_mut() {
                            arr[k] = -1;
                        }
                    }
                }
                g.arcs.pop();
                return None;
            }
        }
    }

    Some(site)
}

#[derive(Debug, Clone, PartialEq)]
pub struct RailExit {
    pub i: i32,
    pub j: i32,
    pub di: i32,
    pub dj: i32,
    pub tx: f64,
    pub tz: f64,
}

pub fn rail_exit(g: &Grid, f: &ArcFeature, l: &LaneBand, cw: bool) -> Option<RailExit> {
    let a_e = if cw { l.a0 + l.span } else { l.a0 };
    let s = if cw { 1.0 } else { -1.0 };
    let tx = -a_e.sin() * s;
    let tz = a_e.cos() * s;
    let rr = if f.solid_out {
        f.r - RAIL_RIDE_INSET
    } else {
        f.r + RAIL_RIDE_INSET
    };
    let ex = f.cx + a_e.cos() * rr;
    let ez = f.cz + a_e.sin() * rr;

    let mut d = RAIL_EXIT_STEP;
    while d <= RAIL_EXIT_MAX + 1e-9 {
        let i = (ex + tx * d).floor() as i32;
        let j = (ez + tz * d).floor() as i32;
        if i < 0 || j < 0 || i >= g.w || j >= g.h {
            return None;
        }
        if is_walkable(g, i, j) {
            let (di, dj) = if tx.abs() >= tz.abs() {
                (tx.signum() as i32, 0)
            } else {
                (0, tz.signum() as i32)
            };
            if di == 0 && dj == 0 {
                return None;
            }
            return Some(RailExit {
                i,
                j,
                di,
                dj,
                tx,
                tz,
            });
        }
        d += RAIL_EXIT_STEP;
    }
    None
}

pub fn arc_tangent_at(f: &ArcFeature, u: f64) -> (f64, f64) {
    let ang = f.a0 + f.span * u;
    (-ang.sin(), ang.cos())
}

pub fn has_clear_rail_runway(
    g: &Grid,
    i: i32,
    j: i32,
    di: i32,
    dj: i32,
    reach: usize,
) -> bool {
    open_runway(g, i, j, di, dj, reach) >= reach
}

fn score_rail(g: &Grid, phi: &[i32], f: &ArcFeature, l: &LaneBand, cw: bool) -> i32 {
    let Some(x) = rail_exit(g, f, l, cw) else {
        return -1;
    };
    if open_runway(g, x.i, x.j, x.di, x.dj, RAIL_MIN_RUNWAY) < RAIL_MIN_RUNWAY {
        return -1;
    }
    if !is_downhill(g, phi, x.i, x.j, x.di, x.dj) {
        return -1;
    }
    let entry = rail_exit(g, f, l, !cw);
    let entry_drop = entry.map_or(0, |e| {
        phi_at(g, phi, e.i, e.j) - phi_at(g, phi, x.i, x.j)
    });
    flow_drop(g, phi, x.i, x.j, x.di, x.dj, RAIL_MIN_RUNWAY) * 4 + 0.max(entry_drop)
}

pub fn orient_arc_rails(g: &mut Grid, phi: &[i32]) -> (usize, usize, usize) {
    let mut kept = 0;
    let mut flipped = 0;
    let mut dropped = 0;

    for f_idx in 0..g.arcs.len() {
        let f = g.arcs[f_idx].clone();
        if f.lanes.is_empty() {
            continue;
        }
        if f.owner == Some("funnel") {
            continue;
        }

        let mut keep = Vec::new();
        for l in &f.lanes {
            let mut l_copy = l.clone();
            let as_authored = score_rail(g, phi, &f, &l_copy, l_copy.cw);
            let reversed = score_rail(g, phi, &f, &l_copy, !l_copy.cw);
            if as_authored < 0 && reversed < 0 {
                dropped += 1;
                continue;
            }
            if reversed > as_authored {
                l_copy.cw = !l_copy.cw;
                flipped += 1;
            } else {
                kept += 1;
            }
            keep.push(l_copy);
        }

        g.arcs[f_idx].lanes = keep;
    }

    (kept, flipped, dropped)
}
