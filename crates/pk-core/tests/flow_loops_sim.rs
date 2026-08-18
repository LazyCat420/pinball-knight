// Parity test for Flow Loops and Directional Raycasts.
// Replicates legacy/src/game/pinball-knight/maze/flow-loops.ts, flow-loops.test.ts

use pk_core::grid::{set_tile, Grid, T_FLOOR};
use pk_core::maze::flow_loops::{exit_ray, summarize_flow_loops, trace_exit_ray, FlowPart};

#[test]
fn exit_ray_traces_open_corridor_and_stops_at_wall() {
    let mut g = Grid::solid(15, 15);
    // Create a 5-tile corridor from (5, 5) to (10, 5)
    for i in 5..=10 {
        set_tile(&mut g, i, 5, T_FLOOR);
    }

    // Facing East (+X) from (5, 5)
    let ray = trace_exit_ray(&g, (5, 5), (1.0, 0.0), 10);
    assert_eq!(ray.len(), 5);
    assert_eq!(ray[0], (6, 5));
    assert_eq!(ray[4], (10, 5));

    let part = FlowPart::new(5, 5, "booster", 1, 0);
    assert_eq!(exit_ray(&part), (1, 0));
}

#[test]
fn summarize_flow_loops_classifies_open_and_blocked_parts() {
    let mut g = Grid::solid(15, 15);
    for j in 1..14 {
        for i in 1..14 {
            set_tile(&mut g, i, j, T_FLOOR);
        }
    }

    let parts = vec![
        // Open launcher in center facing East
        FlowPart {
            i: 5,
            j: 5,
            kind: "launcher".to_string(),
            dir_i: 1,
            dir_j: 0,
            pos: (5, 5),
            dir: (1.0, 0.0),
            ..Default::default()
        },
        // Blocked launcher near edge facing West into wall
        FlowPart {
            i: 1,
            j: 5,
            kind: "launcher".to_string(),
            dir_i: -1,
            dir_j: 0,
            pos: (1, 5),
            dir: (-1.0, 0.0),
            ..Default::default()
        },
    ];

    let summary = summarize_flow_loops(&g, &parts, 3);
    assert_eq!(summary.total_parts, 2);
    assert_eq!(summary.open_exits, 1);
    assert_eq!(summary.blocked_exits, 1);
}
