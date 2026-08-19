//! Delve Catch-Up — Arriving deep without arriving helpless.
//!
//! Port of `legacy/src/game/pinball-knight/delve.ts` (152 lines).
//!
//! PORTS: `delve.ts`

use crate::constants::level::level_config;
use crate::skills::{grant_xp, xp_for_floor_clear, XpState, XP_KILL};

pub const CLEAR_FRACTION: f64 = 0.4;
pub const HEARTS_PER_FLOOR: f64 = 0.5;
pub const HEARTS_CAP: i32 = 6;
pub const UPGRADE_PER_FLOOR: f64 = 0.5;
pub const UPGRADE_CAP: u32 = 5;

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct DelveBoon {
    pub levels: u32,
    pub points: u32,
    pub hearts: i32,
    pub upgrade: u32,
    pub gear: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct DelveState {
    pub level: u32,
    pub xp: u32,
    pub points: u32,
    pub hearts: i32,
    pub upgrade: u32,
}

/// XP a floor is worth to someone who actually fought their way through it.
pub fn floor_xp_income(floor: u32) -> u32 {
    let f = floor.max(1);
    let cfg = level_config(f as i64);
    let kill_xp = (cfg.zombies as f64) * XP_KILL * CLEAR_FRACTION;
    let clear_xp = xp_for_floor_clear(f, "B") as f64;
    (kill_xp + clear_xp).round() as u32
}

/// The progression a knight who WALKED to `floor` would hold on arrival.
pub fn expected_progress(floor: u32) -> XpState {
    let mut s = XpState {
        xp: 0.0,
        level: 1,
        points: 0,
    };
    let target = floor.max(1);
    for f in 1..target {
        let income = floor_xp_income(f);
        let granted = grant_xp(&s, income as f64);
        s = XpState {
            xp: granted.xp,
            level: granted.level,
            points: granted.points,
        };
    }
    s
}

/// Work out the top-up for arriving at `floor` with the progression in `cur`.
pub fn plan_catch_up(floor: u32, cur: &DelveState) -> Option<DelveBoon> {
    let target = floor.max(1);
    if target <= 1 {
        return None;
    }

    let want = expected_progress(target);
    let levels = (want.level as u32).saturating_sub(cur.level);
    let target_hearts = (((target - 1) as f64 * HEARTS_PER_FLOOR).floor() as i32).min(HEARTS_CAP);
    let hearts = (target_hearts - cur.hearts).max(0);
    let upgrade_to = (((target - 1) as f64 * UPGRADE_PER_FLOOR).floor() as u32).min(UPGRADE_CAP);
    let upgrade = if upgrade_to > cur.upgrade {
        upgrade_to
    } else {
        0
    };

    if levels == 0 && hearts == 0 && upgrade == 0 {
        return None;
    }

    Some(DelveBoon {
        levels,
        points: levels,
        hearts,
        upgrade,
        gear: true,
    })
}

/// Apply catch up calculation returning the resulting boon.
pub fn apply_delve_catch_up(floor: u32, cur: &DelveState) -> Option<DelveBoon> {
    plan_catch_up(floor, cur)
}
