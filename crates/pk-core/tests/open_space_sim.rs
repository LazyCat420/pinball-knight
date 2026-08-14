// Parity test for Open Space Geodesic Barrenness Field & Dead Plaza Analysis.
// Replicates legacy/src/game/pinball-knight/maze/open-space.ts, open-space.test.ts

use pk_core::grid::{idx, set_tile, Grid, T_FLOOR};
use pk_core::maze::open_space::{barren_field, open_dead_share, DIAG, ORTH};

#[test]
fn barren_field_computes_chamfer_distances_from_placed_parts() {
    let mut g = Grid::solid(15, 15);
    for j in 1..14 {
        for i in 1..14 {
            set_tile(&mut g, i, j, T_FLOOR);
        }
    }

    let parts = vec![(7, 7)];
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
fn open_dead_share_scores_empty_plaza_higher_than_furnished_corridor() {
    let mut g = Grid::solid(20, 20);
    for j in 1..19 {
        for i in 1..19 {
            set_tile(&mut g, i, j, T_FLOOR);
        }
    }

    // High clearance across the center (large open room)
    let clearance = vec![10_i32; 400];

    // Case A: completely barren (no parts placed)
    let barren_empty = vec![30_i32; 400];
    let share_empty = open_dead_share(&g, &clearance, &barren_empty);
    assert!(
        share_empty > 0.8,
        "Empty plaza must have high open_dead_share"
    );

    // Case B: well-furnished (parts close to all tiles)
    let barren_furnished = vec![3_i32; 400];
    let share_furnished = open_dead_share(&g, &clearance, &barren_furnished);
    assert_eq!(
        share_furnished, 0.0,
        "Furnished plaza must have zero open_dead_share"
    );
}
