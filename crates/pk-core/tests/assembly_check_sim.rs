// Parity test suite for Maze Assembly Validation Rules.
// Replicates legacy/src/game/pinball-knight/maze/assembly-check.ts

use pk_core::grid::{Grid, T_FLOOR};
use pk_core::maze::assembly_check::{validate_maze_assemblies, AssemblyIssueKind, PlacedPart};
use pk_core::pinball::PartKind;

fn make_open_grid(w: i32, h: i32) -> Grid {
    let mut grid = Grid::solid(w, h);
    for j in 1..(h - 1) {
        for i in 1..(w - 1) {
            grid.t[(j * w + i) as usize] = T_FLOOR;
        }
    }
    grid
}

#[test]
fn assembly_check_validates_clear_layout() {
    let grid = make_open_grid(20, 20);

    let parts = vec![
        PlacedPart {
            id: 1,
            kind: PartKind::Booster,
            x: 0.0, // center (tile 10, 10)
            z: 0.0,
        },
        PlacedPart {
            id: 2,
            kind: PartKind::Bumper,
            x: 3.0, // tile 13, 13
            z: 3.0,
        },
    ];

    let result = validate_maze_assemblies(&grid, &parts);
    assert!(result.is_ok());
}

#[test]
fn assembly_check_flags_blocked_launcher_and_overlaps() {
    let grid = Grid::solid(20, 20); // completely solid

    let parts = vec![
        PlacedPart {
            id: 1,
            kind: PartKind::Booster,
            x: 0.0,
            z: 0.0,
        },
        PlacedPart {
            id: 2,
            kind: PartKind::Bumper,
            x: 0.1, // overlapping part 1 (< 0.6m)
            z: 0.1,
        },
    ];

    let result = validate_maze_assemblies(&grid, &parts);
    assert!(result.is_err());
    let issues = result.unwrap_err();

    assert!(issues.iter().any(|i| i.kind == AssemblyIssueKind::BlockedLauncher));
    assert!(issues.iter().any(|i| i.kind == AssemblyIssueKind::OverlappingParts));
}
