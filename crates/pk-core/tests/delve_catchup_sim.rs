// Parity test suite for Delve Catch-Up Progression.
// Replicates legacy/src/game/pinball-knight/delve.ts

use pk_core::run::delve::{
    expected_progress, floor_xp_income, plan_catch_up, DelveState, HEARTS_CAP, UPGRADE_CAP,
};

#[test]
fn floor_one_delve_boon_is_none() {
    let cur = DelveState::default();
    let boon = plan_catch_up(1, &cur);
    assert!(boon.is_none());
}

#[test]
fn deep_delve_boon_scales_and_caps_appropriately() {
    let cur = DelveState {
        level: 1,
        xp: 0,
        points: 0,
        hearts: 0,
        upgrade: 0,
    };
    let boon = plan_catch_up(15, &cur).expect("Should grant delve boon on deep floor");
    assert!(boon.levels > 0);
    assert_eq!(boon.hearts, HEARTS_CAP);
    assert_eq!(boon.upgrade, UPGRADE_CAP);
    assert!(boon.gear);
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

#[test]
fn expected_progress_grows_monotonically() {
    let p3 = expected_progress(3);
    let p6 = expected_progress(6);
    assert!(p6.level >= p3.level);
}
