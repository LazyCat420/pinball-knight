//! Comprehensive parity test suite for legacy/src/game/pinball-knight/maze/decorate.ts.

use pk_core::grid::Grid;
use pk_core::maze::decorate::*;
use pk_core::rng::Mulberry32;

#[test]
fn decorate_constants_and_potion_pool() {
    assert_eq!(POTION_POOL.len(), 10);
    assert_eq!(MAX_LOCK_DUTY, 0.3);
    assert_eq!(PAD_STRIDE, 8);
    assert_eq!(ALT_PAD_STRIDE, 24);
    assert_eq!(STATION_MIN_GAP, 6);
    assert_eq!(ROUTE_CHAIN_REACH, 12);
}

#[test]
fn artery_tracing_and_endpoints() {
    let mut grid = Grid::solid(20, 20);
    for x in 1..19 {
        for z in 1..19 {
            pk_core::grid::set_tile(&mut grid, x, z, pk_core::grid::T_FLOOR);
        }
    }

    let mut rng = Mulberry32::new(42);
    let endpoints = pick_endpoints(&grid, &mut rng).expect("endpoints must be found");
    assert!(endpoints.start.i >= 1 && endpoints.start.j >= 1);
    assert!(endpoints.goal.i >= 1 && endpoints.goal.j >= 1);

    let path = trace_artery(&grid, endpoints.start, endpoints.goal);
    assert!(!path.is_empty());
    assert_eq!(path[0], endpoints.start);
    assert_eq!(path[path.len() - 1], endpoints.goal);
}

#[test]
fn maze_decoration_pass() {
    let mut grid = Grid::solid(30, 30);
    for x in 2..28 {
        for z in 2..28 {
            if (x + z) % 3 != 0 {
                pk_core::grid::set_tile(&mut grid, x, z, pk_core::grid::T_FLOOR);
            }
        }
    }

    let plan = decorate_maze(&mut grid, 12345);
    assert!(!plan.torches.is_empty() || !plan.parts.is_empty());
    assert_eq!(plan.items.len(), 1);
    assert!(plan.items[0].kind == "potion");
}
