// Parity test suite for Nearest Open Tile Ring Shell Scanner.
// Replicates legacy/src/game/pinball-knight/maze/nearest-open-tile.ts

use pk_core::maze::nearest_open_tile::nearest_open_tile;

#[test]
fn nearest_open_tile_finds_first_walkable_neighbor_in_ring_order() {
    // In an all-walkable plane, ring r=1 runs:
    // dj = -1: di = -1, 0, 1 -> (ci-1, cj-1), (ci, cj-1), (ci+1, cj-1)
    let ci = 10;
    let cj = 20;
    let is_walkable = |_i: i32, _j: i32| true;

    let first = nearest_open_tile(ci, cj, 1, 1, is_walkable);
    assert_eq!(first, Some((9, 19)));

    let second = nearest_open_tile(ci, cj, 2, 1, is_walkable);
    assert_eq!(second, Some((10, 19)));

    let third = nearest_open_tile(ci, cj, 3, 1, is_walkable);
    assert_eq!(third, Some((11, 19)));
}

#[test]
fn nearest_open_tile_respects_min_ring_constraint() {
    let ci = 10;
    let cj = 20;
    let is_walkable = |_i: i32, _j: i32| true;

    // min_ring = 2 means r starts at 2: dj = -2, di = -2 -> (ci-2, cj-2) = (8, 18)
    let first_r2 = nearest_open_tile(ci, cj, 1, 2, is_walkable);
    assert_eq!(first_r2, Some((8, 18)));
}

#[test]
fn nearest_open_tile_filters_walls_and_handles_exhaustion() {
    let ci = 10;
    let cj = 20;
    // Only (10, 19) is walkable
    let is_walkable = |i: i32, j: i32| i == 10 && j == 19;

    let only = nearest_open_tile(ci, cj, 1, 1, is_walkable);
    assert_eq!(only, Some((10, 19)));

    // Requesting 5th tile returns the last found tile
    let overflow = nearest_open_tile(ci, cj, 5, 1, is_walkable);
    assert_eq!(overflow, Some((10, 19)));

    // No walkable tiles anywhere returns None
    let none = nearest_open_tile(ci, cj, 1, 1, |_i, _j| false);
    assert_eq!(none, None);
}
