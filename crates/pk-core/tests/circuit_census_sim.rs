// Parity test suite for Circuit Census Flow Analysis.
// Replicates legacy/src/game/pinball-knight/dev/circuit-census.ts

use pk_core::dev::circuit_census::{census_circuits, census_floor};

#[test]
fn census_floor_computes_valid_feed_and_chain_metrics() {
    let row = census_floor(3, 42).expect("floor census runs");
    assert_eq!(row.level, 3);
    assert_eq!(row.seed, 42);
    assert!(row.walkable > 0);
    assert!(row.feed_rate >= 0.0 && row.feed_rate <= 1.0);
    assert_eq!(row.cycles_found, 0); // No soft-lock flow loops
}

#[test]
fn census_circuits_aggregates_across_seed_batch() {
    let seeds = vec![1, 2, 3, 4, 5];
    let report = census_circuits(3, &seeds);

    assert_eq!(report.floors, 5);
    assert_eq!(report.overall.floors, 5);
    assert!(report.overall.feed_rate_mean >= 0.0);
    assert_eq!(report.overall.cycles_total, 0);
    assert!(report.worst_floor.is_some());
}
