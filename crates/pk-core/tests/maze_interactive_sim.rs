// Parity test for Interactive Maze Tiles, Cracked Secret Wall Destruction, and Ground Pickups.
// Replicates legacy/src/game/pinball-knight/maze/decorate.ts, entities/hazards.ts, economy/pickups.ts

use pk_core::grid::{set_tile, Grid, T_CRACKED, T_FLOOR, T_WALL};
use pk_core::maze::interactive::{GroundItemKind, InteractiveMazeState, SECRET_WALL_BREAK_SPEED};

#[test]
fn high_speed_impact_breaks_cracked_wall_to_floor() {
    let mut grid = Grid::solid(10, 10);
    set_tile(&mut grid, 5, 5, T_CRACKED);

    // Fast impact breaks wall
    let broken = InteractiveMazeState::try_break_cracked_wall(&mut grid, 5, 5, SECRET_WALL_BREAK_SPEED + 1.0);
    assert!(broken, "Wall should break at high speed");
    assert_eq!(grid.t[5 * 10 + 5], T_FLOOR, "Tile must become T_FLOOR");
}

#[test]
fn low_speed_impact_does_not_break_cracked_wall() {
    let mut grid = Grid::solid(10, 10);
    set_tile(&mut grid, 5, 5, T_CRACKED);

    // Gentle roll does not break wall
    let broken = InteractiveMazeState::try_break_cracked_wall(&mut grid, 5, 5, SECRET_WALL_BREAK_SPEED - 1.0);
    assert!(!broken, "Wall should not break below speed threshold");
    assert_eq!(grid.t[5 * 10 + 5], T_CRACKED, "Tile must remain T_CRACKED");
}

#[test]
fn regular_wall_never_breaks() {
    let mut grid = Grid::solid(10, 10);
    set_tile(&mut grid, 5, 5, T_WALL);

    let broken = InteractiveMazeState::try_break_cracked_wall(&mut grid, 5, 5, 20.0);
    assert!(!broken, "Solid masonry must never break");
    assert_eq!(grid.t[5 * 10 + 5], T_WALL);
}

#[test]
fn walk_over_collects_nearby_ground_items() {
    let mut maze_state = InteractiveMazeState::default();

    // Spawn 2 items: 1 close, 1 far
    maze_state.spawn_item(2.0, 2.0, GroundItemKind::Coins(50));
    maze_state.spawn_item(8.0, 8.0, GroundItemKind::Potion(25));

    // Player stands near (2.2, 2.1)
    let collected = maze_state.step_pickups(2.2, 2.1);
    assert_eq!(collected.len(), 1);
    assert_eq!(collected[0], GroundItemKind::Coins(50));

    // Far item remains in state
    assert_eq!(maze_state.items.len(), 1);
    assert_eq!(maze_state.items[0].kind, GroundItemKind::Potion(25));
}
