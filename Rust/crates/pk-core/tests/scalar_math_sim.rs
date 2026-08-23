// Parity test suite for Scalar Math Helpers.
// Replicates legacy/src/utils/math.ts

use pk_core::jsmath::scalar::{clamp, clamp01, inv_lerp, lerp};

#[test]
fn scalar_clamp_bounds_values() {
    assert_eq!(clamp(5.0, 0.0, 10.0), 5.0);
    assert_eq!(clamp(-2.0, 0.0, 10.0), 0.0);
    assert_eq!(clamp(15.0, 0.0, 10.0), 10.0);

    assert_eq!(clamp01(-0.5), 0.0);
    assert_eq!(clamp01(0.75), 0.75);
    assert_eq!(clamp01(1.5), 1.0);
}

#[test]
fn scalar_lerp_and_inv_lerp_preserve_linear_relationships() {
    // Exact midpoint
    assert_eq!(lerp(10.0, 20.0, 0.5), 15.0);
    assert_eq!(inv_lerp(10.0, 20.0, 15.0), 0.5);

    // Extrapolation
    assert_eq!(lerp(0.0, 10.0, 2.0), 20.0);

    // Degenerate range
    assert_eq!(inv_lerp(5.0, 5.0, 5.0), 0.0);
}
