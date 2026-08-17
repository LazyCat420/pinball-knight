//! GROWING-TREE MAZE GENERATOR — Pluggable dungeon maze generator spanning Prim's to recursive backtracker.
//!
//! Generates a (2w+1 × 2h+1) tile grid where odd coordinates are floor cells and even coordinates are separating walls.
//!
//! PORTS: `maze/generator.ts`

use crate::grid::{set_tile, Grid, T_FLOOR};
use crate::rng::Mulberry32;

pub const DIRS: [(i32, i32); 4] = [(0, -1), (1, 0), (0, 1), (-1, 0)];

#[derive(Clone, Debug, PartialEq, Default)]
pub struct MazeOpts {
    pub seeds: Option<Vec<(usize, usize)>>,
    pub solid_seeds: bool,
    pub braid_gradient: f64,
}

/// Generates a maze via the growing-tree algorithm parameterised by `windiness` and `braid`.
pub fn generate_maze(
    cells_w: usize,
    cells_h: usize,
    rng: &mut Mulberry32,
    braid: f64,
    windiness: f64,
    opts: &MazeOpts,
) -> Grid {
    assert!(
        cells_w >= 2 && cells_h >= 2,
        "[dungeon] maze needs >=2 cells per side"
    );

    let w = cells_w * 2 + 1;
    let h = cells_h * 2 + 1;
    let mut g = Grid::solid(w as i32, h as i32);

    let mut visited = vec![false; cells_w * cells_h];
    let mut active: Vec<(usize, usize)> = Vec::new();

    // Handle initial seeds if provided
    if let Some(seeds) = &opts.seeds {
        for &(cx, cy) in seeds {
            if cx < cells_w && cy < cells_h {
                visited[cy * cells_w + cx] = true;
                set_tile(&mut g, (cx * 2 + 1) as i32, (cy * 2 + 1) as i32, T_FLOOR);
                active.push((cx, cy));
            }
        }
    }

    if active.is_empty() {
        visited[0] = true;
        set_tile(&mut g, 1, 1, T_FLOOR);
        active.push((0, 0));
    }

    while !active.is_empty() {
        let active_idx = if rng.next_f64() < windiness || active.len() <= 1 {
            active.len() - 1 // Recursive backtracker (newest)
        } else {
            (rng.next_f64() * active.len() as f64) as usize % active.len() // Prim's (random)
        };

        let (cx, cy) = active[active_idx];
        let mut unvisited_neighbors = Vec::new();

        for &(dx, dy) in &DIRS {
            let n_cx = cx as i32 + dx;
            let n_cy = cy as i32 + dy;
            if n_cx >= 0
                && n_cx < cells_w as i32
                && n_cy >= 0
                && n_cy < cells_h as i32
                && !visited[n_cy as usize * cells_w + n_cx as usize]
            {
                unvisited_neighbors.push((n_cx as usize, n_cy as usize, dx, dy));
            }
        }

        if !unvisited_neighbors.is_empty() {
            let pick_idx = (rng.next_f64() * unvisited_neighbors.len() as f64) as usize
                % unvisited_neighbors.len();
            let (n_cx, n_cy, dx, dy) = unvisited_neighbors[pick_idx];

            visited[n_cy * cells_w + n_cx] = true;
            // Carve intermediate wall
            let wall_tx = (cx as i32 * 2 + 1 + dx) as i32;
            let wall_ty = (cy as i32 * 2 + 1 + dy) as i32;
            set_tile(&mut g, wall_tx, wall_ty, T_FLOOR);
            // Carve neighbor cell
            set_tile(
                &mut g,
                (n_cx * 2 + 1) as i32,
                (n_cy * 2 + 1) as i32,
                T_FLOOR,
            );

            active.push((n_cx, n_cy));
        } else {
            active.swap_remove(active_idx);
        }
    }

    // Braiding pass: open loops between existing floor tiles
    if braid > 0.0 {
        for cy in 0..cells_h {
            for cx in 0..cells_w {
                if rng.next_f64() < braid {
                    let dir_idx = (rng.next_f64() * 2.0) as usize; // horizontal or vertical
                    let (dx, dy) = DIRS[dir_idx];
                    let n_cx = cx as i32 + dx;
                    let n_cy = cy as i32 + dy;
                    if n_cx >= 0 && n_cx < cells_w as i32 && n_cy >= 0 && n_cy < cells_h as i32 {
                        let wall_tx = (cx as i32 * 2 + 1 + dx) as i32;
                        let wall_ty = (cy as i32 * 2 + 1 + dy) as i32;
                        set_tile(&mut g, wall_tx, wall_ty, T_FLOOR);
                    }
                }
            }
        }
    }

    g
}
