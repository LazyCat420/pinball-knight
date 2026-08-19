//! GROWING-TREE MAZE GENERATOR — Pluggable dungeon maze generator spanning Prim's to recursive backtracker.
//!
//! Generates a (2w+1 × 2h+1) tile grid where odd coordinates are floor cells and even coordinates are separating walls.
//!
//! Port of `legacy/src/game/pinball-knight/maze/generator.ts` (435 lines).
//!
//! PORTS: `maze/generator.ts`

use crate::grid::{at, set_tile, Grid, T_CRACKED, T_FLOOR, T_WALL};
use crate::maze::track_launch::TilePos;
use crate::rng::Mulberry32;

pub type CellPos = (i32, i32);

pub const DIRS: [(i32, i32); 4] = [(0, -1), (1, 0), (0, 1), (-1, 0)];

#[derive(Clone, Debug, PartialEq, Default)]
pub struct MazeOpts {
    pub seeds: Option<Vec<(usize, usize)>>,
    pub solid_seeds: bool,
    pub braid_gradient: f64,
}

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct Room {
    pub i0: i32,
    pub j0: i32,
    pub w: i32,
    pub h: i32,
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
            (rng.next_f64() * active.len() as f64) as usize // Prim's (random)
        };

        let (cx, cy) = active[active_idx];

        // Find unvisited orthogonal cell neighbours
        let mut unvisited_dirs = Vec::new();
        for &(dx, dy) in &DIRS {
            let nx = cx as i32 + dx;
            let ny = cy as i32 + dy;
            if nx >= 0 && nx < cells_w as i32 && ny >= 0 && ny < cells_h as i32 {
                let n_idx = ny as usize * cells_w + nx as usize;
                if !visited[n_idx] {
                    unvisited_dirs.push((dx, dy, nx as usize, ny as usize));
                }
            }
        }

        if !unvisited_dirs.is_empty() {
            let pick_idx = (rng.next_f64() * unvisited_dirs.len() as f64) as usize;
            let (dx, dy, nx, ny) = unvisited_dirs[pick_idx];

            visited[ny * cells_w + nx] = true;

            // Carve wall between current cell and next cell
            let wall_x = (cx as i32 * 2 + 1) + dx;
            let wall_y = (cy as i32 * 2 + 1) + dy;
            set_tile(&mut g, wall_x, wall_y, T_FLOOR);

            // Carve next cell
            set_tile(&mut g, (nx * 2 + 1) as i32, (ny * 2 + 1) as i32, T_FLOOR);

            active.push((nx, ny));
        } else {
            active.remove(active_idx);
        }
    }

    // Apply loop braiding to dead ends
    if braid > 0.0 {
        for cy in 0..cells_h {
            for cx in 0..cells_w {
                let tx = (cx * 2 + 1) as i32;
                let ty = (cy * 2 + 1) as i32;

                // Count open passages from this cell
                let mut open_dirs = 0;
                let mut closed_dirs = Vec::new();

                for &(dx, dy) in &DIRS {
                    let wx = tx + dx;
                    let wy = ty + dy;
                    let nx = cx as i32 + dx;
                    let ny = cy as i32 + dy;

                    if at(&g, wx, wy) == T_FLOOR {
                        open_dirs += 1;
                    } else if nx >= 0 && nx < cells_w as i32 && ny >= 0 && ny < cells_h as i32 {
                        closed_dirs.push((wx, wy));
                    }
                }

                // If dead end (only 1 open passage), roll to carve a loop
                if open_dirs <= 1 && !closed_dirs.is_empty() && rng.next_f64() < braid {
                    let pick = (rng.next_f64() * closed_dirs.len() as f64) as usize;
                    let (wx, wy) = closed_dirs[pick];
                    set_tile(&mut g, wx, wy, T_FLOOR);
                }
            }
        }
    }

    g
}

pub fn carve_rooms(
    g: &mut Grid,
    rng: &mut impl FnMut() -> f64,
    count: usize,
    min_cells: usize,
    max_cells: usize,
) -> Vec<Room> {
    let cells_w = (g.w - 1) / 2;
    let cells_h = (g.h - 1) / 2;
    let mut rooms: Vec<Room> = Vec::new();

    for _ in 0..(count * 12) {
        if rooms.len() >= count {
            break;
        }
        let cw = min_cells + (rng() * ((max_cells - min_cells + 1) as f64)) as usize;
        let ch = min_cells + (rng() * ((max_cells - min_cells + 1) as f64)) as usize;
        if (cw + 2) as i32 > cells_w || (ch + 2) as i32 > cells_h {
            continue;
        }
        let cx = 1 + (rng() * ((cells_w as usize - cw - 1) as f64)) as usize;
        let cy = 1 + (rng() * ((cells_h as usize - ch - 1) as f64)) as usize;

        let room = Room {
            i0: (cx * 2 + 1) as i32,
            j0: (cy * 2 + 1) as i32,
            w: (cw * 2 - 1) as i32,
            h: (ch * 2 - 1) as i32,
        };

        let clash = rooms.iter().any(|r| {
            room.i0 < r.i0 + r.w + 2
                && r.i0 < room.i0 + room.w + 2
                && room.j0 < r.j0 + r.h + 2
                && r.j0 < room.j0 + room.h + 2
        });

        if clash {
            continue;
        }

        for j in room.j0..(room.j0 + room.h) {
            for i in room.i0..(room.i0 + room.w) {
                set_tile(g, i, j, T_FLOOR);
            }
        }
        rooms.push(room);
    }

    rooms
}

pub fn crack_secret_walls(
    g: &mut Grid,
    rng: &mut impl FnMut() -> f64,
    count: usize,
) -> Vec<TilePos> {
    let mut candidates = Vec::new();
    for j in 1..(g.h - 1) {
        for i in 1..(g.w - 1) {
            if at(g, i, j) != T_WALL {
                continue;
            }
            let horizontal = at(g, i - 1, j) == T_FLOOR && at(g, i + 1, j) == T_FLOOR;
            let vertical = at(g, i, j - 1) == T_FLOOR && at(g, i, j + 1) == T_FLOOR;
            if horizontal || vertical {
                candidates.push(TilePos { i, j });
            }
        }
    }

    // Shuffle
    for i in (1..candidates.len()).rev() {
        let j = (rng() * ((i + 1) as f64)) as usize;
        candidates.swap(i, j);
    }

    let mut picked = Vec::new();
    for c in candidates {
        if picked.len() >= count {
            break;
        }
        if picked.iter().any(|p: &TilePos| (p.i - c.i).abs() + (p.j - c.j).abs() < 8) {
            continue;
        }
        set_tile(g, c.i, c.j, T_CRACKED);
        picked.push(c);
    }

    picked
}

pub fn thicken_walls(g: &Grid) -> Grid {
    let w = g.w * 2;
    let h = g.h * 2;
    let mut out = Grid::solid(w, h);

    for j in 0..g.h {
        for i in 0..g.w {
            let v = at(g, i, j);
            if v == T_WALL {
                continue;
            }
            set_tile(&mut out, i * 2, j * 2, v);
            set_tile(&mut out, i * 2 + 1, j * 2, v);
            set_tile(&mut out, i * 2, j * 2 + 1, v);
            set_tile(&mut out, i * 2 + 1, j * 2 + 1, v);
        }
    }

    out
}
