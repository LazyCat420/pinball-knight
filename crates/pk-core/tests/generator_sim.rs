// Parity test suite for Growing-Tree Maze Generator.
// Replicates legacy/src/game/pinball-knight/maze/generator.ts

use pk_core::grid::{at, T_FLOOR, T_WALL};
use pk_core::maze::generator::{generate_maze, MazeOpts};
use pk_core::rng::Mulberry32;

#[test]
fn maze_generator_produces_valid_lattice_grid() {
    let mut rng = Mulberry32::new(12345);
    let cells_w = 6;
    let cells_h = 6;

    let grid = generate_maze(cells_w, cells_h, &mut rng, 0.1, 0.8, &MazeOpts::default());

    let expected_w = (cells_w * 2 + 1) as i32;
    let expected_h = (cells_h * 2 + 1) as i32;

    assert_eq!(grid.w, expected_w);
    assert_eq!(grid.h, expected_h);

    // Verify cell centers are walkable floor
    for cy in 0..cells_h {
        for cx in 0..cells_w {
            let tx = (cx * 2 + 1) as i32;
            let ty = (cy * 2 + 1) as i32;
            assert_eq!(
                at(&grid, tx, ty),
                T_FLOOR,
                "cell ({}, {}) at tile ({}, {}) must be floor",
                cx,
                cy,
                tx,
                ty
            );
        }
    }

    // Verify outer perimeter is solid wall
    for x in 0..expected_w {
        assert_eq!(at(&grid, x, 0), T_WALL);
        assert_eq!(at(&grid, x, expected_h - 1), T_WALL);
    }
    for y in 0..expected_h {
        assert_eq!(at(&grid, 0, y), T_WALL);
        assert_eq!(at(&grid, expected_w - 1, y), T_WALL);
    }
}
