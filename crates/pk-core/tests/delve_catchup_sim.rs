// Parity test suite for Delve Catch-Up Progression.
// Replicates legacy/src/game/pinball-knight/delve.ts

use pk_core::run::delve::{calculate_delve_boon, floor_xp_income, HEARTS_CAP, UPGRADE_CAP};

#[test]
fn floor_one_delve_boon_is_neutral_baseline() {
    let boon = calculate_delve_boon(1);
    assert_eq!(boon.target_floor, 1);
    assert_eq!(boon.total_xp, 0);
    assert_eq!(boon.bonus_max_hp, 0);
    assert_eq!(boon.weapon_level, 1);
    assert!(!boon.full_armor);
}

#[test]
fn deep_delve_boon_scales_and_caps_appropriately() {
    let boon = calculate_delve_boon(15);
    assert_eq!(boon.target_floor, 15);
    assert!(boon.total_xp > 1000);
    assert_eq!(boon.bonus_max_hp, HEARTS_CAP * 10);
    assert_eq!(boon.weapon_level, 1 + UPGRADE_CAP);
    assert!(boon.full_armor);
}

#[test]
fn floor_xp_income_is_strictly_monotonic_with_depth() {
    let mut prev_xp = 0;
    for f in 1..=10 {
        let xp = floor_xp_income(f);
        assert!(xp > prev_xp, "Floor {} XP should exceed previous", f);
        prev_xp = xp;
    }
}
