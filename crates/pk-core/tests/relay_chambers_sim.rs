// Parity test suite for Relay Chambers Elliptical Bank Arcs.
// Replicates legacy/src/game/pinball-knight/maze/relay-chambers.ts

use pk_core::maze::relay_chambers::{compute_relay_ellipse, sample_relay_arc};
use std::f64::consts::PI;

#[test]
fn relay_ellipse_derives_foci_and_semi_axes() {
    let d1 = (0.0, 0.0);
    let d2 = (10.0, 0.0);
    let standoff = 1.0;

    let ellipse = compute_relay_ellipse(d1, d2, standoff).expect("valid ellipse");

    assert_eq!(ellipse.f1, d1);
    assert_eq!(ellipse.f2, d2);
    assert_eq!(ellipse.center, (5.0, 0.0));
    assert_eq!(ellipse.c, 5.0);
    assert_eq!(ellipse.a, 6.0); // c + standoff
    assert!((ellipse.b - (36.0 - 25.0_f64).sqrt()).abs() < 0.001);
}

#[test]
fn relay_arc_samples_discrete_points() {
    let d1 = (-4.0, 0.0);
    let d2 = (4.0, 0.0);
    let ellipse = compute_relay_ellipse(d1, d2, 1.5).unwrap();

    let arc = sample_relay_arc(&ellipse, -PI * 0.5, PI * 0.5, 5);
    assert_eq!(arc.len(), 5);

    // Top apex theta = PI/2 -> y = +b
    let top_pt = ellipse.point_at(PI * 0.5);
    assert!((top_pt.1 - ellipse.b).abs() < 0.001);
}
