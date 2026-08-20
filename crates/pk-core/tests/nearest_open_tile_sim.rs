// Parity test suite for Nearest Open Tile Ring Shell Scanner.
// Replicates legacy/src/game/pinball-knight/maze/nearest-open-tile.ts

use pk_core::grid::{set_tile, Grid, T_FLOOR};
use pk_core::maze::nearest_open_tile::nearest_open_tile;
use pk_core::maze::track_launch::TilePos;

#[test]
fn nearest_open_tile_finds_first_walkable_neighbor_in_ring_order() {
    // In an all-walkable plane, ring r=1 runs:
    // dj = -1: di = -1, 0, 1 -> (ci-1, cj-1), (ci, cj-1), (ci+1, cj-1)
    let ci = 10;
    let cj = 20;
    let mut grid = Grid::solid(30, 40);
    for j in 0..40 {
        for i in 0..30 {
            set_tile(&mut grid, i, j, T_FLOOR);
        }
    }

    let first = nearest_open_tile(&grid, ci, cj, 1, 1);
    assert_eq!(first, Some(TilePos { i: 9, j: 19 }));

    let second = nearest_open_tile(&grid, ci, cj, 2, 1);
    assert_eq!(second, Some(TilePos { i: 10, j: 19 }));

    let third = nearest_open_tile(&grid, ci, cj, 3, 1);
    assert_eq!(third, Some(TilePos { i: 11, j: 19 }));
}

#[test]
fn nearest_open_tile_respects_min_ring_constraint() {
    let ci = 10;
    let cj = 20;
    let mut grid = Grid::solid(30, 40);
    for j in 0..40 {
        for i in 0..30 {
            set_tile(&mut grid, i, j, T_FLOOR);
        }
    }

    // min_ring = 2 means r starts at 2: dj = -2, di = -2 -> (ci-2, cj-2) = (8, 18)
    let first_r2 = nearest_open_tile(&grid, ci, cj, 1, 2);
    assert_eq!(first_r2, Some(TilePos { i: 8, j: 18 }));
}

#[test]
fn nearest_open_tile_filters_walls_and_handles_exhaustion() {
    let ci = 10;
    let cj = 20;
    let mut grid = Grid::solid(30, 40);
    // Only (10, 19) is walkable
    set_tile(&mut grid, 10, 19, T_FLOOR);

    let only = nearest_open_tile(&grid, ci, cj, 1, 1);
    assert_eq!(only, Some(TilePos { i: 10, j: 19 }));

    // Requesting 5th tile returns the last found tile
    let overflow = nearest_open_tile(&grid, ci, cj, 5, 1);
    assert_eq!(overflow, Some(TilePos { i: 10, j: 19 }));

    // No walkable tiles anywhere returns None
    let solid_grid = Grid::solid(30, 40);
    let none = nearest_open_tile(&solid_grid, ci, cj, 1, 1);
    assert_eq!(none, None);
}
