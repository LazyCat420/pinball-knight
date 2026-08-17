//! Comprehensive parity test suite for legacy/src/game/pinball-knight/entities/multiball.ts.

use std::collections::{HashMap, VecDeque};
use pk_core::entities::multiball::*;

#[test]
fn trail_sampling_and_push() {
    let mut trail = VecDeque::new();
    push_trail(&mut trail, 0.0, 0.0, 0.0, 1.0);
    push_trail(&mut trail, 10.0, 0.0, 1.0, 1.0);

    // Sample halfway at t = 0.5
    let mid = sample_trail(&trail, 0.5);
    assert!(mid.is_some());
    let (x, z) = mid.unwrap();
    assert!((x - 5.0).abs() < 1e-6);
    assert_eq!(z, 0.0);
}

#[test]
fn echo_target_offset_calculation() {
    let mut trail = VecDeque::new();
    push_trail(&mut trail, 0.0, 0.0, 0.0, 2.0);
    push_trail(&mut trail, 0.0, 10.0, 1.0, 2.0);
    push_trail(&mut trail, 0.0, 20.0, 2.0, 2.0);

    // Echo 0.5s behind at t = 1.5 with side offset 1.0
    let target = echo_target(&trail, 1.5, 0.5, 1.0);
    assert!(target.is_some());
    let (tx, tz) = target.unwrap();
    assert!((tx - -1.0).abs() < 1e-6 || (tx - 1.0).abs() < 1e-6);
    assert!((tz - 10.0).abs() < 1e-6);
}

#[test]
fn ram_cooldowns_and_lifecycle() {
    let mut cds = HashMap::new();
    cds.insert(42, 0.5);

    assert!(!can_ram(&cds, 42));
    assert!(can_ram(&cds, 99));

    tick_ram_cooldowns(&mut cds, 0.6);
    assert!(can_ram(&cds, 42));

    dispose_multi_ball();
    assert!(!multi_ball_active());

    spawn_multi_ball(5.0, 5.0);
    assert!(multi_ball_active());
    let positions = multi_ball_positions();
    assert_eq!(positions.len(), MULTIBALL_COUNT);

    update_multi_ball(6.0, 5.0, 0.1);
    dispose_multi_ball();
    assert!(!multi_ball_active());
}
