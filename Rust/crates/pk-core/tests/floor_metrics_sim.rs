// Parity test for Floor Navigation Metrics.
// Replicates legacy/src/game/pinball-knight/maze/floor-metrics.ts, floor-metrics.test.ts

use pk_core::flow_field::bfs_distances;
use pk_core::grid::{set_tile, Grid, T_FLOOR, T_STAIRS};
use pk_core::maze::floor_metrics::{
    check_floor, format_metrics, largest_chamber, measure_floor, trace_route,
    walkable_count, wall_count, DEFAULT_CONSTRAINTS,
};
use pk_core::maze::floor_spec::{build_track_floor_from_spec, derive_floor_spec};
use pk_core::maze::track_launch::TilePos;

#[test]
fn largest_chamber_identifies_open_5x5_neighborhoods() {
    let mut g = Grid::solid(20, 20);
    // Carve a 7x7 open plaza in the center: (5..=11, 5..=11)
    for j in 5..=11 {
        for i in 5..=11 {
            set_tile(&mut g, i, j, T_FLOOR);
        }
    }
    // A 7x7 open area contains (7-4)*(7-4) = 3*3 = 9 tiles that have a full 5x5 open neighborhood (r=2)
    let chamber = largest_chamber(&g);
    assert_eq!(chamber, 9);
}

#[test]
fn trace_route_finds_optimal_downhill_path() {
    let mut g = Grid::solid(15, 15);
    // Simple L-shaped corridor from (1, 1) -> (1, 5) -> (5, 5)
    for j in 1..=5 {
        set_tile(&mut g, 1, j, T_FLOOR);
    }
    for i in 2..=5 {
        set_tile(&mut g, i, 5, T_FLOOR);
    }
    set_tile(&mut g, 5, 5, T_STAIRS);

    let start = TilePos { i: 1, j: 1 };
    let stairs = TilePos { i: 5, j: 5 };
    let dist = bfs_distances(&g, start.i, start.j);
    let route = trace_route(&g, start, stairs, &dist);

    assert_eq!(route.len(), 9);
    assert_eq!(route[0], start);
    assert_eq!(route[8], stairs);
}

#[test]
fn measure_floor_computes_complete_metrics_suite() {
    let mut spec = derive_floor_spec(3, 1);
    let floor = build_track_floor_from_spec(&mut spec).expect("floor");

    let m = measure_floor(&floor.grid, floor.start, floor.stairs, None, None);
    assert!(m.walkable > 0);
    assert!(m.open_share > 0.3);
    assert_eq!(m.reach_share, 1.0);
    assert!(m.path_len > 0);
    assert!(m.directness > 0.0 && m.directness <= 1.0);
    assert!(m.turn_rate >= 0.0);
    assert_eq!(m.region_reach_share, 1.0);

    let violations = check_floor(&m, &floor.grid, &DEFAULT_CONSTRAINTS);
    assert!(
        violations.is_empty(),
        "generated floor violated floor constraints: {:?}",
        violations
    );

    let formatted = format_metrics(&m);
    assert!(formatted.contains("tiles="));
    assert!(formatted.contains("open="));
    assert!(formatted.contains("reach=1.0000"));
}

#[test]
fn walkable_and_wall_count_account_for_all_tiles() {
    let mut g = Grid::solid(10, 10);
    for i in 2..=8 {
        set_tile(&mut g, i, 5, T_FLOOR);
    }
    assert_eq!(walkable_count(&g), 7);
    assert_eq!(wall_count(&g), 93);
}
