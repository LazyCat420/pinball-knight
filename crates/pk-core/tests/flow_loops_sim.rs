// Simulation test suite for Flow Loops detection and breaking.
// Replicates legacy/src/game/pinball-knight/maze/flow-loops.ts

use pk_core::grid::{Grid, T_FLOOR};
use pk_core::maze::flow_loops::{
    break_flow_loops, exit_ray, find_flow_cycles, successors_of, FlowPart,
};

fn make_loop_grid() -> Grid {
    let mut g = Grid::solid(10, 10);
    for j in 1..9 {
        for i in 1..9 {
            g.t[(j * 10 + i) as usize] = T_FLOOR;
        }
    }
    g
}

#[test]
fn exit_ray_resolves_second_leg_for_boostcorner() {
    let corner = FlowPart {
        kind: "boostcorner".to_string(),
        dir_i: 1,
        dir_j: 0,
        dir2_i: 0,
        dir2_j: 1,
        ..Default::default()
    };
    assert_eq!(exit_ray(&corner), (0, 1));
}

#[test]
fn find_flow_cycles_and_break_flow_loops() {
    let g = make_loop_grid();
    // 4 boosters pointing into each other in a loop:
    // (2,2)->(6,2)->(6,6)->(2,6)->(2,2)
    let mut parts = vec![
        FlowPart::new(2, 2, "booster", 1, 0),
        FlowPart::new(6, 2, "booster", 0, 1),
        FlowPart::new(6, 6, "booster", -1, 0),
        FlowPart::new(2, 6, "booster", 0, -1),
    ];

    let succ = successors_of(&g, &parts);
    assert_eq!(succ.len(), 4);

    let cycles = find_flow_cycles(&g, &parts);
    assert_eq!(cycles.len(), 1);
    assert_eq!(cycles[0].len(), 4);

    let mut phi = vec![100; 100];
    // Create downhill toward (2, 2)
    phi[2 * 10 + 2] = 10;
    phi[6 * 10 + 2] = 20;
    phi[6 * 10 + 6] = 30;
    phi[2 * 10 + 6] = 40;

    let broken = break_flow_loops(&g, &phi, &mut parts);
    assert!(broken > 0);

    let cycles_after = find_flow_cycles(&g, &parts);
    assert!(cycles_after.is_empty(), "All loops must be broken");
}
