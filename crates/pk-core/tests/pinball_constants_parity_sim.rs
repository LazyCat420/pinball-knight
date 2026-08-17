//! Comprehensive parity test suite for legacy/src/game/pinball-knight/constants/pinball.ts.

use pk_core::constants::pinball::*;

#[test]
fn pinball_momentum_and_friction_constants() {
    assert_eq!(OVERCHARGE_TIME, 1.4);
    assert_eq!(OVERCHARGE_DECAY, 1.0);
    assert_eq!(PINBALL_WALL_RESTITUTION, 0.94);
    assert_eq!(PINBALL_CORNER_RESTITUTION, 1.08);
    assert_eq!(PINBALL_MAX_SPEED, 22.0);
    assert_eq!(PINBALL_FRICTION, 0.9);
    assert_eq!(FRICTION_OPEN, 0.35);
    assert_eq!(FRICTION_CORRIDOR, 1.0);
    assert_eq!(FRICTION_TIGHT, 2.1);
}

#[test]
fn combo_curve_math_evaluation() {
    // Speed ceiling starts near base and approaches PINBALL_MAX_SPEED
    let speed_0 = combo_speed_ceil(0);
    let speed_50 = combo_speed_ceil(50);
    let speed_100 = combo_speed_ceil(100);
    assert!(speed_0 <= COMBO_CEIL_BASE);
    assert!(speed_50 > speed_0);
    assert!(speed_100 <= PINBALL_MAX_SPEED);

    // Damage multiplier starts at 1.0 below cruise and scales up
    assert_eq!(combo_damage_mult(5), 1.0);
    let dmg_50 = combo_damage_mult(50);
    assert!(dmg_50 > 1.0 && dmg_50 <= COMBO_DMG_MAX);

    // Window shrinks with combo
    let win_0 = combo_window(0);
    let win_50 = combo_window(50);
    assert!(win_0 > win_50);
    assert!(win_50 >= COMBO_WINDOW_MIN);
}

#[test]
fn named_combos_table() {
    assert_eq!(NAMED_COMBOS.len(), 12);
    assert_eq!(NAMED_COMBOS[0].name, "GRAND TOUR");
    assert_eq!(NAMED_COMBOS[0].gold, 120);
    assert_eq!(NAMED_COMBOS[1].name, "PINBALL WIZARD");
    assert_eq!(NAMED_COMBOS[1].gold, 150);
}

#[test]
fn part_launch_speeds_and_lifetimes() {
    assert_eq!(SPRING_SPEED, 16.0);
    assert_eq!(RAMP_SPEED, 13.0);
    assert_eq!(DEFLECTOR_THROW_SPEED, 19.0);
    assert_eq!(BOOSTER_SPEED, 17.5);
    assert_eq!(FLIPPER_TIP_SPEED, 21.0);
    assert_eq!(GLOVE_PUNCH_SPEED, 20.0);
    assert_eq!(TRAPDOOR_LIFETIME, 2.05);
    assert_eq!(FIRE_VENT_LIFETIME, 1.60);
}
