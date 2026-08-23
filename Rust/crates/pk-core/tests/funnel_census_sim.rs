// Parity test suite for Doorway Funnel Census.
// Replicates legacy/src/game/pinball-knight/dev/funnel-census.ts

use pk_core::dev::funnel_census::census_funnels;

#[test]
fn funnel_census_measures_doorway_metrics() {
    let report = census_funnels(3, 42);

    assert_eq!(report.level, 3);
    assert_eq!(report.seed, 42);
    assert!(report.doorways > 0);
    assert!(report.samples > 0);
    assert!(report.overall.capture_rate > 0.0 && report.overall.capture_rate <= 1.0);
    assert!(report.overall.rejection_rate >= 0.0 && report.overall.rejection_rate <= 1.0);
    assert!(report.overall.median_bounces >= 0.0);
}
