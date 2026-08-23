// Comprehensive simulation test suite for Maze Decoration & Furniture Pass.
// Replicates legacy/src/game/pinball-knight/maze/decorate.ts

use pk_core::grid::{set_tile, Grid, T_FLOOR, T_STAIRS};
use pk_core::maze::decorate::*;
use pk_core::maze::TilePos;
use pk_core::rng::Mulberry32;

#[test]
fn pick_endpoints_finds_far_journey() {
    let mut grid = Grid::solid(25, 25);
    for j in 1..24 {
        for i in 1..24 {
            set_tile(&mut grid, i, j, T_FLOOR);
        }
    }

    let mut rng = Mulberry32::new(999);
    let endpoints = pick_endpoints(&grid, &mut rng).expect("Endpoints found");

    assert_ne!(endpoints.start, endpoints.stairs);
    let dx = (endpoints.start.i - endpoints.stairs.i).abs();
    let dy = (endpoints.start.j - endpoints.stairs.j).abs();
    assert!(dx + dy >= 15);
}

#[test]
fn widen_main_artery_carves_path() {
    let mut grid = Grid::solid(20, 20);
    // Single 1-wide hallway from (1, 1) to (18, 1)
    for i in 1..19 {
        set_tile(&mut grid, i, 1, T_FLOOR);
    }
    for j in 1..19 {
        set_tile(&mut grid, 18, j, T_FLOOR);
    }

    let ends = Endpoints {
        start: TilePos { i: 1, j: 1 },
        stairs: TilePos { i: 18, j: 18 },
    };

    widen_main_artery(&mut grid, &ends);

    // Adjacent perpendicular tile along hallway should be widened to floor
    let mut floor_count = 0;
    for j in 1..20 {
        for i in 1..20 {
            if pk_core::grid::at(&grid, i, j) == T_FLOOR {
                floor_count += 1;
            }
        }
    }
    assert!(floor_count > 36);
}

#[test]
fn open_launch_targets_and_break_duels() {
    let mut grid = Grid::solid(15, 15);
    for i in 1..14 {
        set_tile(&mut grid, i, 7, T_FLOOR);
    }

    // Two opposing springs facing each other
    let mut parts = vec![
        PinballPartSpot {
            i: 5,
            j: 7,
            kind: "spring".to_string(),
            dir_i: 1,
            dir_j: 0,
            dir2_i: 0,
            dir2_j: 0,
            spine: false,
            chain: false,
        },
        PinballPartSpot {
            i: 6,
            j: 7,
            kind: "spring".to_string(),
            dir_i: -1,
            dir_j: 0,
            dir2_i: 0,
            dir2_j: 0,
            spine: false,
            chain: false,
        },
    ];

    let fixed = break_launch_duels(&grid, &mut parts);
    assert_eq!(fixed, 1);
    // One spring was converted to bumper or re-aimed
    assert!(parts[0].kind != "spring" || parts[1].kind != "spring" || parts[0].dir_i != -parts[1].dir_i);
}

#[test]
fn decorate_maze_full_plan_generation() {
    let mut grid = Grid::solid(30, 30);
    for j in 1..29 {
        for i in 1..29 {
            if (i % 2 == 1) || (j % 2 == 1) {
                set_tile(&mut grid, i, j, T_FLOOR);
            }
        }
    }

    let mut rng = Mulberry32::new(54321);
    let plan = decorate_maze(&mut grid, &mut rng, 10, 15, 20, Vec::new());

    assert_ne!(plan.start, plan.stairs);
    assert!(!plan.torches.is_empty());
    assert!(!plan.parts.is_empty());
    assert!(!plan.monster_spawns.is_empty());
    assert_eq!(pk_core::grid::at(&grid, plan.stairs.i, plan.stairs.j), T_STAIRS);
}
