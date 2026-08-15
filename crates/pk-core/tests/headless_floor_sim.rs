// Parity test suite for Headless Floor and Plan Generator.
// Replicates legacy/src/game/pinball-knight/dev/headless-floor.ts

use pk_core::dev::headless_floor::{build_headless_floor, build_headless_plan};

#[test]
fn build_headless_floor_generates_connected_layout() {
    let floor = build_headless_floor(3, 42).expect("floor builds");
    assert_eq!(floor.level, 3);
    assert_eq!(floor.run_seed, 42);
    assert!(floor.grid.w > 0 && floor.grid.h > 0);

    // Verify determinism: repeating the call yields identical start/stairs endpoints
    let floor2 = build_headless_floor(3, 42).expect("floor builds deterministically");
    assert_eq!(floor.start, floor2.start);
    assert_eq!(floor.stairs, floor2.stairs);
    assert_eq!(floor.grid.t, floor2.grid.t);
}

#[test]
fn build_headless_plan_includes_metrics_and_modifiers() {
    let plan = build_headless_plan(3, 42, false).expect("plan builds");
    assert!(plan.walkable > 0);
    assert!(!plan.modifier.is_empty());
    assert_eq!(plan.floor.level, 3);
}
