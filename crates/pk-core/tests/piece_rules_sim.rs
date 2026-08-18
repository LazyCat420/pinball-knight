// Parity test for Maze Piece Rules & Legality Validator.
// Replicates legacy/src/game/pinball-knight/maze/piece-rules.ts, piece-rules.test.ts

use pk_core::grid::{set_tile, Grid, T_FLOOR, T_STAIRS, T_WALL};
use pk_core::maze::floor_spec::{build_track_floor_from_spec, derive_floor_spec};
use pk_core::maze::flow_loops::FlowPart;
use pk_core::maze::piece_rules::{
    check_pieces, piece_at, piece_census, summarise, PieceContent, PieceLabel,
};

#[test]
fn piece_rules_flags_isolated_pillar_and_blocked_launcher() {
    let mut g = Grid::solid(15, 15);
    for j in 1..14 {
        for i in 1..14 {
            set_tile(&mut g, i, j, T_FLOOR);
        }
    }
    set_tile(&mut g, 14, 14, T_STAIRS);

    // Create an isolated wall pillar at (5, 5)
    set_tile(&mut g, 5, 5, T_WALL);

    let parts = vec![
        // Launcher facing West into solid outer wall
        FlowPart {
            i: 1,
            j: 7,
            kind: "booster".to_string(),
            dir_i: -1,
            dir_j: 0,
            ..Default::default()
        },
    ];

    let content = PieceContent {
        phi: None,
        parts: Some(&parts),
    };
    let violations = check_pieces(&g, None, Some(&content));
    assert!(violations.len() >= 2);

    let labels: Vec<PieceLabel> = violations.iter().map(|v| v.label).collect();
    assert!(labels.contains(&PieceLabel::WallBox));
    assert!(labels.contains(&PieceLabel::Furniture));

    let summary = summarise(&violations);
    assert!(summary.contains("wall-box"));
    assert!(summary.contains("furniture"));
}

#[test]
fn piece_at_and_census_correctly_categorize_elements() {
    let mut g = Grid::solid(10, 10);
    set_tile(&mut g, 1, 1, T_FLOOR);
    set_tile(&mut g, 2, 2, T_STAIRS);

    assert_eq!(piece_at(&g, None, 1, 1), PieceLabel::FloorRoom);
    assert_eq!(piece_at(&g, None, 2, 2), PieceLabel::Stairs);
    assert_eq!(piece_at(&g, None, 0, 0), PieceLabel::WallBox);

    let census = piece_census(&g, None);
    assert_eq!(*census.get("stairs").unwrap_or(&0), 1);
    assert_eq!(*census.get("floor-room").unwrap_or(&0), 1);
    assert_eq!(*census.get("wall-box").unwrap_or(&0), 98);
}

#[test]
fn piece_rules_pass_on_clean_generated_floor() {
    let mut spec = derive_floor_spec(3, 1);
    let floor = build_track_floor_from_spec(&mut spec).expect("floor");

    let violations = check_pieces(&floor.grid, None, None);
    assert!(
        violations.is_empty(),
        "generated floor has piece rule violations: {:?}",
        violations
    );
}
