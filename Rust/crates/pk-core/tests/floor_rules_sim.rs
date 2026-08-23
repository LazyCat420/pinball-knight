// Parity test for Floor Rules and Spatial Invariants.
// Replicates legacy/src/game/pinball-knight/maze/floor-rules.test.ts

use pk_core::flow_field::bfs_distances;
use pk_core::grid::{set_tile, Grid, T_FLOOR, T_STAIRS};
use pk_core::maze::archetypes::ArchetypeId;
use pk_core::maze::doorways::clearance_field;
use pk_core::maze::floor_rules::{
    check_floor_rules, max_reach, perimeter_score, FloorRuleContext, DEFAULT_RULE_WEIGHTS,
};
use pk_core::maze::floor_spec::{build_track_floor_from_spec, derive_floor_spec};
use pk_core::maze::nearest_open_tile::nearest_open_tile;
use pk_core::maze::track_launch::TilePos;

#[test]
fn perimeter_score_matches_oracle_formula() {
    let g = Grid::solid(30, 20);
    // Perimeter half is 20 / 2 = 10.0
    // At corner (0, 0): d = 0 => 1.0
    assert!((perimeter_score(&g, 0, 0) - 1.0).abs() < 1e-6);
    // At (5, 5): d = 5 => 1 - 5/10 = 0.5
    assert!((perimeter_score(&g, 5, 5) - 0.5).abs() < 1e-6);
    // At center (15, 10): d = 9 => 1 - 9/10 = 0.1
    assert!((perimeter_score(&g, 15, 10) - 0.1).abs() < 1e-6);
    // Near dead center (10, 10): d = 9 => 0.1
    assert!((perimeter_score(&g, 10, 10) - 0.1).abs() < 1e-6);
}

#[test]
fn max_reach_measures_furthest_walkable_tile() {
    let mut g = Grid::solid(10, 10);
    for i in 1..=8 {
        set_tile(&mut g, i, 1, T_FLOOR);
    }
    let dist = bfs_distances(&g, 1, 1);
    assert_eq!(max_reach(&g, &dist), 7);
}

#[test]
fn floor_rules_pass_on_clean_generated_floor() {
    let mut spec = derive_floor_spec(3, 1);
    let floor = build_track_floor_from_spec(&mut spec).expect("floor");

    let dist = bfs_distances(&floor.grid, floor.start.i, floor.start.j);
    let boss_spot = nearest_open_tile(&floor.grid, floor.stairs.i, floor.stairs.j, 2, 0)
        .unwrap_or(floor.stairs);
    let clearance = clearance_field(&floor.grid);

    let ctx = FloorRuleContext {
        grid: &floor.grid,
        start: floor.start,
        stairs: floor.stairs,
        boss_spot,
        dist_from_start: &dist,
        archetype: spec.archetype.id,
        weights: DEFAULT_RULE_WEIGHTS,
        relaxed: Some(&floor.relaxed),
        doorways: Some(&floor.doorways),
        clearance: Some(&clearance),
    };

    let violations = check_floor_rules(&ctx);
    assert!(
        violations.is_empty(),
        "generated floor has rule violations: {:?}",
        violations
    );
}

#[test]
fn floor_rules_flag_unreachable_spawn_and_boss() {
    let mut g = Grid::solid(20, 20);
    set_tile(&mut g, 2, 2, T_FLOOR); // spawn
    set_tile(&mut g, 15, 15, T_STAIRS); // stairs (isolated)

    let dist = bfs_distances(&g, 2, 2);
    let ctx = FloorRuleContext {
        grid: &g,
        start: TilePos { i: 2, j: 2 },
        stairs: TilePos { i: 15, j: 15 },
        boss_spot: TilePos { i: 15, j: 15 },
        dist_from_start: &dist,
        archetype: ArchetypeId::GreatHall,
        weights: DEFAULT_RULE_WEIGHTS,
        relaxed: None,
        doorways: None,
        clearance: None,
    };

    let violations = check_floor_rules(&ctx);
    assert!(!violations.is_empty());
    let rule_ids: Vec<&str> = violations.iter().map(|v| v.rule_id).collect();
    assert!(rule_ids.contains(&"boss-not-near-spawn"));
    assert!(rule_ids.contains(&"exit-not-near-spawn"));
}
