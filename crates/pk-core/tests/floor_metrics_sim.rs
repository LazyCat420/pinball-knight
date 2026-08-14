// Parity test for Floor Navigation Metrics.
// Replicates legacy/src/game/pinball-knight/maze/floor-metrics.ts, floor-metrics.test.ts

use pk_core::grid::{set_tile, Grid, T_FLOOR};
use pk_core::maze::floor_metrics::analyze_floor_metrics;

#[test]
fn analyze_floor_metrics_calculates_topological_depth_and_dead_ends() {
    let mut g = Grid::solid(10, 10);
    // Create a 1-tile corridor from (1, 1) to (1, 5) with a dead end branch at (2, 3)
    for j in 1..=5 {
        set_tile(&mut g, 1, j, T_FLOOR);
    }
    set_tile(&mut g, 2, 3, T_FLOOR); // Dead end

    let start = (1, 1);
    let exit = (1, 5);

    let metrics = analyze_floor_metrics(&g, start, exit);

    assert_eq!(metrics.total_floor_tiles, 6);
    assert_eq!(metrics.reachable_tiles, 6);
    assert_eq!(metrics.critical_path_length, 4); // 4 steps from (1,1) to (1,5)
    assert_eq!(metrics.dead_ends, 1); // tile at (2,3) has 1 neighbor
}
