// Parity test suite for Trail Ribbon VFX particle pool.
// Replicates legacy/src/game/pinball-knight/fx/pools/trail-ribbon.ts

use pk_core::marble::trail_ribbon::{
    TrailRibbon, LASER_TRAIL_LIFE, TRAIL_CAPACITY, TRAIL_LIFE, TRAIL_PUSH_RATE,
};

#[test]
fn trail_ribbon_capacity_exceeds_push_rate_and_life() {
    // Assert capacity >= push_rate * laser_life invariant
    let required_pts = (TRAIL_PUSH_RATE as f64 * LASER_TRAIL_LIFE).ceil() as usize;
    assert!(TRAIL_CAPACITY >= required_pts);
}

#[test]
fn trail_ribbon_pushes_and_calculates_alpha_falloff() {
    let mut ribbon = TrailRibbon::new(TRAIL_LIFE, [1.0, 1.0, 0.0]);

    // Push 3 points at t = 0.0, 0.1, 0.2
    ribbon.push_point(0.0, 0.0, 0.0, 0.0);
    ribbon.push_point(1.0, 0.0, 1.0, 0.1);
    ribbon.push_point(2.0, 0.0, 2.0, 0.2);

    assert_eq!(ribbon.count, 3);

    // At now = 0.2:
    // pt0 age = 0.2s -> alpha = 1.0 - (0.2 / 0.45) = ~0.555
    // pt2 age = 0.0s -> alpha = 1.0
    let pts = ribbon.active_points(0.2);
    assert_eq!(pts.len(), 3);
    assert!((pts[0].3 - 0.555).abs() < 0.01);
    assert!((pts[2].3 - 1.0).abs() < 0.001);
}

#[test]
fn trail_ribbon_expires_old_points_on_step() {
    let mut ribbon = TrailRibbon::new(TRAIL_LIFE, [1.0, 1.0, 0.0]);

    ribbon.push_point(0.0, 0.0, 0.0, 0.0);
    ribbon.push_point(1.0, 0.0, 1.0, 0.1);

    // Advance clock past 0.45s life for point 0 (now = 0.50s)
    ribbon.step(0.50);

    let pts = ribbon.active_points(0.50);
    assert_eq!(pts.len(), 1);
    assert_eq!(pts[0].0, 1.0); // Only second point remains
}
