// Simulation test suite for Procedural Floor Authoring.
// Replicates legacy/src/game/pinball-knight/spawn/floor-authoring.ts

use pk_core::grid::is_walkable;
use pk_core::spawn::floor_authoring::*;

#[test]
fn floor_authoring_generates_valid_floor() {
    let authored = author_floor(1, 12345, false);

    assert_eq!(authored.level, 1);
    assert!(authored.grid.w > 10);
    assert!(authored.grid.h > 10);

    // Endpoints must be on walkable tiles
    assert!(is_walkable(&authored.grid, authored.plan.start.i, authored.plan.start.j));
    assert!(is_walkable(&authored.grid, authored.plan.stairs.i, authored.plan.stairs.j));

    // Must have authored content
    assert!(!authored.plan.torches.is_empty());
    assert!(!authored.plan.parts.is_empty());
}

#[test]
fn floor_authoring_seed_determinism() {
    let floor_a = author_floor(3, 42, false);
    let floor_b = author_floor(3, 42, false);

    assert_eq!(floor_a.grid.w, floor_b.grid.w);
    assert_eq!(floor_a.grid.h, floor_b.grid.h);
    assert_eq!(floor_a.grid.t, floor_b.grid.t);
    assert_eq!(floor_a.plan.start, floor_b.plan.start);
    assert_eq!(floor_a.plan.stairs, floor_b.plan.stairs);
}

#[test]
fn floor_authoring_scales_with_depth() {
    let floor_1 = author_floor(1, 999, false);
    let floor_5 = author_floor(5, 999, false);

    assert!(floor_5.grid.w >= floor_1.grid.w);
    assert!(floor_5.grid.h >= floor_1.grid.h);
}
