//! Delve Catch-Up — Arriving deep without arriving helpless.
//!
//! PORTS: `delve.ts`

pub const CLEAR_FRACTION: f64 = 0.4;
pub const HEARTS_PER_FLOOR: f64 = 0.5;
pub const HEARTS_CAP: i32 = 6;
pub const UPGRADE_PER_FLOOR: f64 = 0.5;
pub const UPGRADE_CAP: u32 = 5;

#[derive(Clone, Debug, PartialEq)]
pub struct DelveBoon {
    pub target_floor: u32,
    pub total_xp: u32,
    pub bonus_max_hp: i32,
    pub weapon_level: u32,
    pub full_armor: bool,
}

/// Evaluates the expected XP earned on a floor:
/// estimated 40% horde kills (base 10 XP/kill) + floor clear award (100 * floor).
pub fn floor_xp_income(floor: u32) -> u32 {
    let f = floor.max(1);
    // Estimated horde size scales smoothly with depth
    let estimated_zombies = 15 + f * 5;
    let kill_xp = (estimated_zombies as f64 * 10.0 * CLEAR_FRACTION) as u32;
    let clear_xp = 100 * f;
    kill_xp + clear_xp
}

/// Calculates the catch-up boon for a knight dropping directly onto `target_floor`.
pub fn calculate_delve_boon(target_floor: u32) -> DelveBoon {
    let f = target_floor.max(1);
    if f <= 1 {
        return DelveBoon {
            target_floor: 1,
            total_xp: 0,
            bonus_max_hp: 0,
            weapon_level: 1,
            full_armor: false,
        };
    }

    let floors_cleared = f - 1;
    let mut total_xp = 0;
    for prev_f in 1..=floors_cleared {
        total_xp += floor_xp_income(prev_f);
    }

    let bonus_hearts = ((floors_cleared as f64 * HEARTS_PER_FLOOR).floor() as i32).min(HEARTS_CAP);
    let bonus_hp = bonus_hearts * 10;

    let weapon_upgrades = ((floors_cleared as f64 * UPGRADE_PER_FLOOR).floor() as u32).min(UPGRADE_CAP);
    let weapon_level = 1 + weapon_upgrades;

    DelveBoon {
        target_floor: f,
        total_xp,
        bonus_max_hp: bonus_hp,
        weapon_level,
        full_armor: floors_cleared >= 3,
    }
}
