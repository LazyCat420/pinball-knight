//! FLOW ORIENTATION — the floor's single source of truth for "which way is onward".
//!
//! PORTS: `maze/flow-orient.ts`

use crate::grid::{at, idx, is_walkable, Grid, T_FLOOR, T_STAIRS};

pub const CARDS: [(i32, i32); 4] = [
    (1, 0),
    (-1, 0),
    (0, 1),
    (0, -1),
];

pub const UNREACHED: i32 = 0x3fffffff;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct TilePos {
    pub i: i32,
    pub j: i32,
}

pub fn build_flow_field(g: &Grid, stairs: TilePos) -> Vec<i32> {
    let size = (g.w * g.h) as usize;
    let mut phi = vec![UNREACHED; size];
    if !is_walkable(g, stairs.i, stairs.j) {
        return phi;
    }
    let mut q = vec![0usize; size];
    let mut head = 0;
    let mut tail = 0;
    let s = idx(g, stairs.i, stairs.j);
    phi[s] = 0;
    q[tail] = s;
    tail += 1;

    while head < tail {
        let k = q[head];
        head += 1;
        let i = (k as i32) % g.w;
        let j = (k as i32) / g.w;
        let d = phi[k] + 1;
        for (di, dj) in CARDS {
            let ni = i + di;
            let nj = j + dj;
            if ni < 0 || nj < 0 || ni >= g.w || nj >= g.h {
                continue;
            }
            let nk = idx(g, ni, nj);
            if phi[nk] != UNREACHED {
                continue;
            }
            let t = g.t[nk];
            if t != T_FLOOR && t != T_STAIRS {
                continue;
            }
            phi[nk] = d;
            q[tail] = nk;
            tail += 1;
        }
    }
    phi
}

pub fn phi_at(g: &Grid, phi: &[i32], i: i32, j: i32) -> i32 {
    if i < 0 || j < 0 || i >= g.w || j >= g.h {
        return UNREACHED;
    }
    phi[idx(g, i, j)]
}

pub fn is_downhill(g: &Grid, phi: &[i32], i: i32, j: i32, di: i32, dj: i32) -> bool {
    let here = phi_at(g, phi, i, j);
    let there = phi_at(g, phi, i + di, j + dj);
    if here >= UNREACHED || there >= UNREACHED {
        return false;
    }
    there < here
}

pub fn flow_drop(g: &Grid, phi: &[i32], i: i32, j: i32, di: i32, dj: i32, reach: usize) -> i32 {
    let here = phi_at(g, phi, i, j);
    if here >= UNREACHED {
        return 0;
    }
    let mut best = here;
    for s in 1..=reach {
        let ni = i + di * (s as i32);
        let nj = j + dj * (s as i32);
        let t = at(g, ni, nj);
        if t != T_FLOOR && t != T_STAIRS {
            break;
        }
        let v = phi_at(g, phi, ni, nj);
        if v < best {
            best = v;
        }
    }
    here - best
}

pub fn open_runway(g: &Grid, i: i32, j: i32, di: i32, dj: i32, max: usize) -> usize {
    let mut n = 0;
    for s in 1..=max {
        let t = at(g, i + di * (s as i32), j + dj * (s as i32));
        if t != T_FLOOR && t != T_STAIRS {
            break;
        }
        n += 1;
    }
    n
}

pub fn steepest_down(g: &Grid, phi: &[i32], i: i32, j: i32) -> Option<(i32, i32)> {
    let mut best = None;
    let mut best_drop = 0;
    for c in CARDS {
        let drop = flow_drop(g, phi, i, j, c.0, c.1, 8);
        if drop > best_drop {
            best_drop = drop;
            best = Some(c);
        }
    }
    best
}

pub fn descend<F: Fn(TilePos) -> bool>(
    g: &Grid,
    phi: &[i32],
    from: TilePos,
    until: i32,
    max_len: usize,
    stop: Option<F>,
) -> Vec<TilePos> {
    let mut path = Vec::new();
    let mut cur = from;
    for _ in 0..max_len {
        path.push(cur);
        if phi_at(g, phi, cur.i, cur.j) <= until {
            break;
        }
        let mut next = None;
        let here = phi_at(g, phi, cur.i, cur.j);
        for (di, dj) in CARDS {
            let ni = cur.i + di;
            let nj = cur.j + dj;
            if phi_at(g, phi, ni, nj) == here - 1 {
                next = Some(TilePos { i: ni, j: nj });
                break;
            }
        }
        let Some(nxt) = next else {
            break;
        };
        if let Some(ref s) = stop {
            if s(nxt) {
                break;
            }
        }
        cur = nxt;
    }
    path
}
