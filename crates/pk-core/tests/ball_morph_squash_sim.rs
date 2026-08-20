// Parity test for Ball Morph Area-Preserving Squash and Stretch Physics.
// Replicates legacy/src/game/pinball-knight/entities/marble.ts, marble-forms.test.ts

use pk_core::marble::squash::{BallSquash, SQUASH_MIN_SPEED, SQUASH_RECOVER};

#[test]
fn squash_scales_are_strictly_area_preserving() {
    let mut squash = BallSquash::default();
    squash.record_impact(1.0, 0.0, 12.0);

    let (sx, sy) = squash.scale();
    assert!(sx != 1.0 || sy != 1.0);
    // Area preservation assertion: sx * sy == 1.0
    let area = sx * sy;
    assert!(
        (area - 1.0).abs() < 1e-4,
        "Squash and stretch must preserve apparent area, got {area}"
    );
}

#[test]
fn squash_recovers_to_unit_scale_over_time() {
    let mut squash = BallSquash::default();
    squash.record_impact(0.0, 1.0, 14.0);

    assert!(squash.timer > 0.0);

    // Step recovery
    squash.update(SQUASH_RECOVER + 0.05);
    let (sx, sy) = squash.scale();
    assert_eq!(sx, 1.0);
    assert_eq!(sy, 1.0);
}

#[test]
fn gentle_rolls_below_speed_threshold_do_not_squash() {
    let mut squash = BallSquash::default();
    squash.record_impact(1.0, 0.0, SQUASH_MIN_SPEED - 1.0);

    assert_eq!(squash.timer, 0.0);
    let (sx, sy) = squash.scale();
    assert_eq!(sx, 1.0);
    assert_eq!(sy, 1.0);
}
