// Parity test for Maze Piece Rules & Legality Validator.
// Replicates legacy/src/game/pinball-knight/maze/piece-rules.ts, piece-rules.test.ts

use pk_core::grid::{set_tile, Grid, T_FLOOR};
use pk_core::maze::flow_loops::FlowPart;
use pk_core::maze::piece_rules::{validate_piece_rules, PieceViolationKind};

#[test]
fn validate_piece_rules_flags_blocked_launchers() {
    let mut g = Grid::solid(15, 15);
    for j in 1..14 {
        for i in 1..14 {
            set_tile(&mut g, i, j, T_FLOOR);
        }
    }

    let parts = vec![
        // Launcher facing West into solid outer wall
        FlowPart {
            kind: "launcher".to_string(),
            pos: (1, 7),
            dir: (-1.0, 0.0),
        },
    ];

    let violations = validate_piece_rules(&g, &parts);
    assert_eq!(violations.len(), 1);
    assert_eq!(
        violations[0].kind,
        PieceViolationKind::BlockedLauncherRunway
    );
    assert_eq!(violations[0].tile, (1, 7));
}
