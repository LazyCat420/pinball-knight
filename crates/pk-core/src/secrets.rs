//! SECRET WALLS — the smash-through payoff.
//!
//! Stamping, pruning, and revolving door physics for cracked secret wall bands.
//!
//! PORTS-PARTIAL: `secrets.ts` - NOT a finished port - 2 of 8 exported names carried over (25%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

use crate::grid::{
    at, is_walkable, set_tile, shape_at, Grid, SHAPE_FULL, T_CRACKED, T_FLOOR, T_WALL,
};

pub const REVOLVE_TIME: f64 = 0.85;
pub const REVOLVE_SWEEP: f64 = std::f64::consts::PI * 1.15;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TilePos {
    pub i: i32,
    pub j: i32,
}

pub fn stamp_secret_bands<R: FnMut() -> f64, F: Fn(i32, i32) -> bool>(
    g: &mut Grid,
    mut rng: R,
    count: usize,
    spacing: i32,
    avoid: F,
) -> Vec<TilePos> {
    if count == 0 {
        return Vec::new();
    }
    let plain = |grid: &Grid, i: i32, j: i32| -> bool {
        at(grid, i, j) == T_WALL && shape_at(grid, i, j) == SHAPE_FULL && !avoid(i, j)
    };
    let floor = |grid: &Grid, i: i32, j: i32| -> bool { at(grid, i, j) == T_FLOOR };

    let mut candidates: Vec<TilePos> = Vec::new();
    let h = g.h;
    let w = g.w;
    let mut j = 2;
    while j + 1 <= h - 3 {
        let mut i = 2;
        while i + 1 <= w - 3 {
            if plain(g, i, j) && plain(g, i + 1, j) && plain(g, i, j + 1) && plain(g, i + 1, j + 1)
            {
                let horizontal = floor(g, i - 1, j)
                    && floor(g, i - 1, j + 1)
                    && floor(g, i + 2, j)
                    && floor(g, i + 2, j + 1);
                let vertical = floor(g, i, j - 1)
                    && floor(g, i + 1, j - 1)
                    && floor(g, i, j + 2)
                    && floor(g, i + 1, j + 2);
                if horizontal || vertical {
                    candidates.push(TilePos { i, j });
                }
            }
            i += 2;
        }
        j += 2;
    }

    // Fisher-Yates shuffle
    if candidates.len() > 1 {
        for k in (1..candidates.len()).rev() {
            let q = (rng() * ((k + 1) as f64)).floor() as usize;
            candidates.swap(k, q.min(k));
        }
    }

    let mut picked: Vec<TilePos> = Vec::new();
    for c in candidates {
        if picked.len() >= count {
            break;
        }
        if picked
            .iter()
            .any(|p| (p.i - c.i).abs() + (p.j - c.j).abs() < spacing)
        {
            continue;
        }
        for &(di, dj) in &[(0, 0), (1, 0), (0, 1), (1, 1)] {
            set_tile(g, c.i + di, c.j + dj, T_CRACKED);
        }
        picked.push(c);
    }
    picked
}

pub fn prune_sealed_bands(g: &mut Grid, secrets: &mut Vec<TilePos>) -> usize {
    let open = |grid: &Grid, i: i32, j: i32| -> bool {
        is_walkable(grid, i + 1, j)
            || is_walkable(grid, i - 1, j)
            || is_walkable(grid, i, j + 1)
            || is_walkable(grid, i, j - 1)
    };
    let mut dropped = 0;
    let mut k = secrets.len();
    while k > 0 {
        k -= 1;
        let s = secrets[k];
        let mut sealed = false;
        for &(di, dj) in &[(0, 0), (1, 0), (0, 1), (1, 1)] {
            if at(g, s.i + di, s.j + dj) == T_CRACKED && !open(g, s.i + di, s.j + dj) {
                sealed = true;
                break;
            }
        }
        if sealed {
            for &(di, dj) in &[(0, 0), (1, 0), (0, 1), (1, 1)] {
                if at(g, s.i + di, s.j + dj) == T_CRACKED {
                    set_tile(g, s.i + di, s.j + dj, T_WALL);
                }
            }
            secrets.swap_remove(k);
            dropped += 1;
        }
    }
    dropped
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_grid_stamps_zero_bands() {
        let mut g = Grid::solid(20, 20);
        let stamped = stamp_secret_bands(&mut g, || 0.5, 4, 8, |_, _| false);
        assert_eq!(stamped.len(), 0);
    }
}
