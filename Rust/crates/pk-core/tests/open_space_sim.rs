// Parity test for Open Space Geodesic Barrenness Field & Dead Plaza Analysis.
// Replicates legacy/src/game/pinball-knight/maze/open-space.ts, open-space.test.ts

use pk_core::grid::{idx, set_tile, Grid, T_FLOOR};
use pk_core::maze::floor_spec::{build_track_floor_from_spec, derive_floor_spec};
use pk_core::maze::open_space::{
    barren_field, check_open_space, format_open_space, measure_open_space,
    DEFAULT_OPEN_SPACE, DIAG, ORTH,
};
use pk_core::maze::track_launch::TilePos;

#[test]
fn barren_field_computes_chamfer_distances_from_placed_parts() {
    let mut g = Grid::solid(15, 15);
    for j in 1..14 {
        for i in 1..14 {
            set_tile(&mut g, i, j, T_FLOOR);
        }
    }

    let parts = vec![TilePos { i: 7, j: 7 }];
    let field = barren_field(&g, &parts);

    // Part tile itself is distance 0
    assert_eq!(field[idx(&g, 7, 7)], 0);

    // Orthogonal neighbors are distance ORTH (3)
    assert_eq!(field[idx(&g, 8, 7)], ORTH);
    assert_eq!(field[idx(&g, 6, 7)], ORTH);
    assert_eq!(field[idx(&g, 7, 8)], ORTH);
    assert_eq!(field[idx(&g, 7, 6)], ORTH);

    // Diagonal neighbors are distance DIAG (4)
    assert_eq!(field[idx(&g, 8, 8)], DIAG);
    assert_eq!(field[idx(&g, 6, 6)], DIAG);

    // Outer wall tiles remain unreachable (-1)
    assert_eq!(field[idx(&g, 0, 0)], -1);
}

#[test]
fn measure_open_space_scores_distribution_accurately() {
    let mut g = Grid::solid(25, 25);
    for j in 1..24 {
        for i in 1..24 {
            set_tile(&mut g, i, j, T_FLOOR);
        }
    }

    // Single part at corner (2, 2)
    let parts = vec![TilePos { i: 2, j: 2 }];
    let m = measure_open_space(&g, &parts, None);

    assert_eq!(m.parts, 1);
    assert!(m.worst_barren > 20.0);
    assert!(m.dead_share > 0.0);

    let formatted = format_open_space(&m);
    assert!(formatted.contains("walkable"));
    assert!(formatted.contains("parts 1"));
    assert!(formatted.contains("worstBarren"));
}

#[test]
fn open_space_metrics_on_clean_generated_floor() {
    let mut spec = derive_floor_spec(3, 1);
    let floor = build_track_floor_from_spec(&mut spec).expect("floor");

    // Sparse parts test (only 2 parts): should accurately detect high barrenness
    let sparse_parts = vec![floor.start, floor.stairs];
    let m_sparse = measure_open_space(&floor.grid, &sparse_parts, None);
    assert!(m_sparse.walkable > 0);
    assert_eq!(m_sparse.parts, 2);
    assert!(m_sparse.dead_share > 0.5);

    // Distributed parts test: uniformly spaced furniture across walkable tiles
    let mut distributed_parts = Vec::new();
    for j in (0..floor.grid.h).step_by(6) {
        for i in (0..floor.grid.w).step_by(6) {
            if pk_core::grid::is_walkable(&floor.grid, i, j) {
                distributed_parts.push(TilePos { i, j });
            }
        }
    }
    let m_dist = measure_open_space(&floor.grid, &distributed_parts, None);
    assert!(m_dist.worst_barren <= DEFAULT_OPEN_SPACE.max_worst_barren);
    let bad = check_open_space(&m_dist, &DEFAULT_OPEN_SPACE);
    assert!(bad.is_empty(), "open space check failed: {:?}", bad);
}
