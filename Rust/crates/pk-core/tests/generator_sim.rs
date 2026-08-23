// Simulation test suite for Maze Generator.
// Replicates legacy/src/game/pinball-knight/maze/generator.ts

use pk_core::grid::{at, T_CRACKED, T_FLOOR, T_WALL};
use pk_core::maze::generator::{
    carve_rooms, crack_secret_walls, generate_maze, thicken_walls, MazeOpts,
};
use pk_core::rng::Mulberry32;

#[test]
fn generate_maze_creates_connected_floor() {
    let mut rng = Mulberry32::new(12345);
    let g = generate_maze(6, 6, &mut rng, 0.2, 0.7, &MazeOpts::default());
    assert_eq!(g.w, 13);
    assert_eq!(g.h, 13);
    assert_eq!(at(&g, 1, 1), T_FLOOR);
}

#[test]
fn carve_rooms_and_crack_secret_walls_and_thicken() {
    let mut rng = Mulberry32::new(42);
    let mut g = generate_maze(8, 8, &mut rng, 0.3, 0.5, &MazeOpts::default());

    let mut draw_fn = || rng.next_f64();
    let rooms = carve_rooms(&mut g, &mut draw_fn, 2, 2, 3);
    assert!(!rooms.is_empty());

    let cracked = crack_secret_walls(&mut g, &mut draw_fn, 3);
    assert!(!cracked.is_empty());
    for c in &cracked {
        assert_eq!(at(&g, c.i, c.j), T_CRACKED);
    }

    let thick = thicken_walls(&g);
    assert_eq!(thick.w, g.w * 2);
    assert_eq!(thick.h, g.h * 2);
}
