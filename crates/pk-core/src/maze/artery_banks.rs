//! ARTERY BANKS — long banked turns carved into the main highway.
//!
//! Port of `legacy/src/game/pinball-knight/maze/artery-banks.ts`.
//!
//! PORTS: `maze/artery-banks.ts`

use std::collections::HashSet;
use std::f64::consts::{FRAC_PI_2, PI};

use crate::flow_field::bfs_distances;
use crate::grid::{
    at, ensure_arcs, idx, is_walkable, set_shape, set_tile, shape_at, Grid, T_FLOOR, T_WALL,
};
use crate::maze::arc_contract::junction_clear;
use crate::maze::flow_orient::TilePos;
use crate::tile_shape::{angle_in_span, ArcFeature, LaneBand, SHAPE_ARC, SHAPE_FULL};

pub const WALL_SIDES: [(i32, i32); 4] = [(0, -1), (0, 1), (-1, 0), (1, 0)];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Heading {
    pub di: i32,
    pub dj: i32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Bend {
    pub corner: TilePos,
    pub in_dir: Heading,
    pub out_dir: Heading,
    pub run_in: i32,
    pub turn: i32,
    pub at: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub struct BendChain {
    pub bends: Vec<Bend>,
    pub total_turn: f64,
}

pub fn turn_of(a: Heading, b: Heading) -> i32 {
    a.di * b.dj - a.dj * b.di
}

pub fn find_bends(path: &[TilePos]) -> Vec<Bend> {
    let mut out = Vec::new();
    if path.len() < 3 {
        return out;
    }

    let mut run = 1;
    for k in 2..path.len() {
        let in_dir = Heading {
            di: path[k - 1].i - path[k - 2].i,
            dj: path[k - 1].j - path[k - 2].j,
        };
        let out_dir = Heading {
            di: path[k].i - path[k - 1].i,
            dj: path[k].j - path[k - 1].j,
        };
        if in_dir.di == out_dir.di && in_dir.dj == out_dir.dj {
            run += 1;
            continue;
        }
        let t = turn_of(in_dir, out_dir);
        if t != 0 {
            out.push(Bend {
                corner: path[k - 1],
                in_dir,
                out_dir,
                run_in: run,
                turn: if t > 0 { 1 } else { -1 },
                at: k - 1,
            });
        }
        run = 1;
    }
    out
}

pub fn chain_bends(bends: &[Bend], max_gap: usize) -> Vec<BendChain> {
    let mut chains = Vec::new();
    let mut cur: Vec<Bend> = Vec::new();
    for b in bends {
        if cur.is_empty() {
            cur.push(b.clone());
            continue;
        }
        let gap = b.at - cur[cur.len() - 1].at;
        if gap <= max_gap {
            cur.push(b.clone());
        } else {
            let total_turn = (cur.len() as f64 * PI) / 2.0;
            chains.push(BendChain {
                bends: std::mem::take(&mut cur),
                total_turn,
            });
            cur.push(b.clone());
        }
    }
    if !cur.is_empty() {
        let total_turn = (cur.len() as f64 * PI) / 2.0;
        chains.push(BendChain {
            bends: cur,
            total_turn,
        });
    }
    chains
}

#[derive(Clone, Debug, PartialEq)]
pub struct ArcForBend {
    pub cx: f64,
    pub cz: f64,
    pub r: f64,
    pub a0: f64,
    pub span: f64,
    pub cw: bool,
}

pub fn arc_for_bend(b: &Bend, ri: f64, w: f64) -> ArcForBend {
    let ro = ri + w;
    let px = b.corner.i as f64 + 0.5;
    let pz = b.corner.j as f64 + 0.5;
    let bx = (b.in_dir.di + b.out_dir.di) as f64;
    let bz = (b.in_dir.dj + b.out_dir.dj) as f64;
    let bl = bx.hypot(bz);
    let bl = if bl == 0.0 { 1.0 } else { bl };
    let cx = px + (bx / bl) * ro;
    let cz = pz + (bz / bl) * ro;
    let entry_ang = (pz - cz).atan2(px - cx);
    let span = FRAC_PI_2;
    let a0 = entry_ang - span / 2.0;
    ArcForBend {
        cx,
        cz,
        r: ro,
        a0,
        span,
        cw: b.turn > 0,
    }
}

pub fn chain_arc_length(chain: &BendChain, ri: f64, w: f64) -> f64 {
    (ri + w) * chain.total_turn
}

pub const BANK_MIN_RUNIN: i32 = 4;
pub const BANK_CHAIN_GAP: usize = 3;
pub const BANK_MAX_PER_FLOOR: usize = 6;
pub const BANK_RI: f64 = 2.0;
pub const BANK_W: f64 = 3.0;
pub const BANK_LANE_FRAC: f64 = 0.94;

#[derive(Clone, Debug)]
pub struct BankPlan {
    pub feature: ArcFeature,
    pub arc_tiles: Vec<TilePos>,
    pub fill_tiles: Vec<TilePos>,
}

pub fn plan_artery_banks<F1: Fn(i32, i32) -> bool, F2: Fn(i32, i32) -> bool>(
    g: &Grid,
    path: &[TilePos],
    occupied: &F1,
    limit: usize,
    protect: &F2,
) -> Vec<BankPlan> {
    let mut plans = Vec::new();
    let mut claimed = HashSet::new();
    let bends: Vec<Bend> = find_bends(path)
        .into_iter()
        .filter(|b| b.run_in >= BANK_MIN_RUNIN)
        .collect();
    let chains = chain_bends(&bends, BANK_CHAIN_GAP);

    for chain in chains {
        if plans.len() >= limit {
            break;
        }
        for b in chain.bends {
            if plans.len() >= limit {
                break;
            }
            let a = arc_for_bend(&b, BANK_RI, BANK_W);
            if let Some(plan) = plan_one_bank(g, &a, occupied, &claimed, protect) {
                for t in &plan.arc_tiles {
                    claimed.insert(idx(g, t.i, t.j));
                }
                for t in &plan.fill_tiles {
                    claimed.insert(idx(g, t.i, t.j));
                }
                plans.push(plan);
            }
        }
    }
    plans
}

fn plan_one_bank<F1: Fn(i32, i32) -> bool, F2: Fn(i32, i32) -> bool>(
    g: &Grid,
    a: &ArcForBend,
    occupied: &F1,
    claimed: &HashSet<usize>,
    protect: &F2,
) -> Option<BankPlan> {
    let mut arc_tiles = Vec::new();
    let mut fill_tiles = Vec::new();

    let lo = (a.cx - a.r - 2.0).floor() as i32;
    let hi = (a.cx + a.r + 2.0).ceil() as i32;
    let loz = (a.cz - a.r - 2.0).floor() as i32;
    let hiz = (a.cz + a.r + 2.0).ceil() as i32;
    if lo <= 0 || loz <= 0 || hi >= g.w - 1 || hiz >= g.h - 1 {
        return None;
    }

    for j in loz..=hiz {
        for i in lo..=hi {
            let dx = i as f64 + 0.5 - a.cx;
            let dz = j as f64 + 0.5 - a.cz;
            let d = dx.hypot(dz);
            if d < a.r - 0.5 || d > a.r + 1.5 {
                continue;
            }
            if !angle_in_span(dz.atan2(dx), a.a0, a.span) {
                continue;
            }
            let k = idx(g, i, j);
            if claimed.contains(&k) {
                return None;
            }
            if shape_at(g, i, j) != SHAPE_FULL {
                return None;
            }
            if occupied(i, j) {
                return None;
            }
            let t = at(g, i, j);
            if t != T_FLOOR && t != T_WALL {
                return None;
            }
            if t == T_FLOOR && protect(i, j) {
                return None;
            }
            if d <= a.r + 0.5 {
                if t == T_FLOOR {
                    arc_tiles.push(TilePos { i, j });
                }
            } else if t == T_FLOOR {
                fill_tiles.push(TilePos { i, j });
            }
        }
    }

    if arc_tiles.len() < 3 {
        return None;
    }

    let band_span = a.span * BANK_LANE_FRAC;
    let feature = ArcFeature {
        cx: a.cx,
        cz: a.cz,
        r: a.r,
        a0: a.a0,
        span: a.span,
        solid_out: true,
        owner: Some("track"),
        kicks: Vec::new(),
        lanes: vec![LaneBand {
            a0: a.a0 + (a.span - band_span) / 2.0,
            span: band_span,
            cw: a.cw,
            cooldown_t: 0.0,
            hit_t: -1.0,
        }],
    };

    Some(BankPlan {
        feature,
        arc_tiles,
        fill_tiles,
    })
}

pub fn commit_bank(g: &mut Grid, plan: &BankPlan) {
    ensure_arcs(g);
    let fi = g.arcs.len() as i16;
    let mut feat = plan.feature.clone();
    feat.owner = Some("track");
    g.arcs.push(feat);
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

pub fn revert_bank(g: &mut Grid, plan: &mut BankPlan) {
    plan.feature.lanes.clear();
    plan.feature.kicks.clear();
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

fn strands(g: &Grid, start: TilePos) -> bool {
    let d = bfs_distances(g, start.i, start.j);
    for j in 0..g.h {
        for i in 0..g.w {
            if is_walkable(g, i, j) && d[idx(g, i, j)] < 0 {
                return true;
            }
        }
    }
    false
}

pub fn author_artery_banks<F1: Fn(i32, i32) -> bool, F2: Fn(i32, i32) -> bool>(
    g: &mut Grid,
    path: &[TilePos],
    start: TilePos,
    occupied: &F1,
    protect: &F2,
) -> usize {
    let mut plans = plan_artery_banks(g, path, occupied, BANK_MAX_PER_FLOOR, protect);
    if plans.is_empty() {
        return 0;
    }

    let mut kept = 0;
    for p in &mut plans {
        let arc_coords: Vec<(i32, i32)> = p.arc_tiles.iter().map(|t| (t.i, t.j)).collect();
        let feat = ArcFeature {
            owner: Some("track"),
            ..p.feature.clone()
        };
        if !junction_clear(g, &arc_coords, &feat) {
            continue;
        }
        commit_bank(g, p);
        if strands(g, start) {
            revert_bank(g, p);
        } else {
            kept += 1;
        }
    }
    kept
}

pub fn trace_artery(g: &Grid, start: TilePos, stairs: TilePos, dist: &[i32]) -> Vec<TilePos> {
    let mut cur = stairs;
    let mut guard = 0;
    let mut back = vec![cur];
    let max_guard = (g.w * g.h) as usize;

    while !(cur.i == start.i && cur.j == start.j) && guard < max_guard {
        guard += 1;
        let dcur = dist[idx(g, cur.i, cur.j)];
        let mut next = None;
        for (di, dj) in WALL_SIDES {
            let ni = cur.i + di;
            let nj = cur.j + dj;
            if at(g, ni, nj) == T_WALL {
                continue;
            }
            if dist[idx(g, ni, nj)] == dcur - 1 {
                next = Some(TilePos { i: ni, j: nj });
                break;
            }
        }
        let Some(nxt) = next else {
            break;
        };
        cur = nxt;
        back.push(cur);
    }

    back.reverse();
    back
}
