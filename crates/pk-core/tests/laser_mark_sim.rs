// Parity test suite for Laser Mark Field Stamping Pool.
// Replicates legacy/src/game/pinball-knight/fx/pools/laser-mark-field.ts

use pk_core::marble::laser_mark_field::{LaserMarkField, MARK_CAP, MARK_LIFE, MARK_STEPS};

#[test]
fn laser_mark_field_stamps_and_overwrites_at_capacity() {
    let mut field = LaserMarkField::new();

    // Stamp 50 marks (capacity is 48)
    for i in 0..50 {
        field.stamp(
            i as f32,
            0.0,
            0.0,
            1.0,
            0.0,
            0.5,
            [1.0, 1.0, 1.0],
        );
    }

    assert_eq!(field.count, MARK_CAP);
    assert_eq!(field.head, 2); // 50 % 48 = 2
}

#[test]
fn laser_mark_field_ages_and_expires() {
    let mut field = LaserMarkField::new();

    field.stamp(0.0, 0.0, 0.0, 1.0, 0.0, 0.5, [1.0, 0.5, 0.2]);

    let initial = field.live_marks();
    assert_eq!(initial.len(), 1);
    assert_eq!(initial[0].1, MARK_STEPS[0]); // 3.0 initial bloom brightness

    // Step halfway
    field.step(MARK_LIFE * 0.5);
    let mid = field.live_marks();
    assert_eq!(mid.len(), 1);
    assert!(mid[0].1 < MARK_STEPS[0]);

    // Step to expiration
    field.step(MARK_LIFE);
    let final_marks = field.live_marks();
    assert_eq!(final_marks.len(), 0);
}
