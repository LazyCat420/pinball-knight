// Parity test suite for Open-Space Floor Density Census.
// Replicates legacy/src/game/pinball-knight/dev/open-space-census.ts

use pk_core::maze::open_space_census::{run_open_space_census, FloorCensusRow};

#[test]
fn open_space_census_aggregates_stats_and_detects_worst_floor() {
    let rows = vec![
        FloorCensusRow {
            level: 1,
            seed: 101,
            archetype: "ruins".to_string(),
            modifier: "none".to_string(),
            walkable: 1000,
            parts: 50,
            parts_per_1k: 50.0,
            worst_barren: 4.2,
            dead_share: 0.12,
            open_dead_share: 0.05,
            open_share: 0.30,
        },
        FloorCensusRow {
            level: 2,
            seed: 102,
            archetype: "ruins".to_string(),
            modifier: "none".to_string(),
            walkable: 1200,
            parts: 48,
            parts_per_1k: 40.0,
            worst_barren: 5.8,
            dead_share: 0.20,
            open_dead_share: 0.15,
            open_share: 0.40,
        },
        FloorCensusRow {
            level: 3,
            seed: 103,
            archetype: "catacombs".to_string(),
            modifier: "dense".to_string(),
            walkable: 800,
            parts: 60,
            parts_per_1k: 75.0,
            worst_barren: 3.1,
            dead_share: 0.08,
            open_dead_share: 0.02,
            open_share: 0.20,
        },
    ];

    let report = run_open_space_census(&rows, 3.5);

    assert_eq!(report.floors, 3);
    assert_eq!(report.by_archetype.len(), 2);
    assert!(report.by_archetype.contains_key("ruins"));
    assert!(report.by_archetype.contains_key("catacombs"));

    // Worst floor by open_dead_share is level 2 (0.15)
    let worst = report.worst_floor.expect("Must have worst floor");
    assert_eq!(worst.level, 2);
    assert_eq!(worst.seed, 102);
    assert_eq!(worst.open_dead_share, 0.15);
}
