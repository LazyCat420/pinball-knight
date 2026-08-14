//! Dungeon floor progression budgets and difficulty metrics.
//!
//! PORTS: `constants/level.ts`

pub const FLOOR_BUDGET_BASE: usize = 14;
pub const FLOOR_BUDGET_STEP: usize = 3;
pub const FLOOR_BUDGET_MAX: usize = 64;

pub const BOSS_FLOORS: [u32; 3] = [5, 10, 15];

/// Computes total opening horde budget for a given floor depth.
pub fn level_horde_budget(floor: u32) -> usize {
    let raw = FLOOR_BUDGET_BASE + ((floor.max(1) - 1) as usize * FLOOR_BUDGET_STEP);
    raw.min(FLOOR_BUDGET_MAX)
}

/// Computes maze dimensions based on floor depth.
pub fn level_grid_size(floor: u32) -> (i32, i32) {
    match floor {
        1..=3 => (24, 24),
        4..=7 => (28, 28),
        8..=11 => (32, 32),
        _ => (36, 36),
    }
}

/// Identifies environmental theme name for a floor.
pub fn level_theme(floor: u32) -> &'static str {
    match floor {
        1..=4 => "CATACOMBS",
        5 => "ROYAL CRYPT (BOSS)",
        6..=9 => "SEWERS & PIPES",
        10 => "SLIME SANCTUM (BOSS)",
        11..=14 => "LAVA FORGE",
        _ => "THRONE ROOM",
    }
}

/// Returns whether a floor is a designated Boss floor.
pub fn is_boss_floor(floor: u32) -> bool {
    BOSS_FLOORS.contains(&floor)
}

/// Number of reward chests placed on the floor.
pub fn level_chests_count(floor: u32) -> usize {
    if is_boss_floor(floor) {
        3
    } else {
        1 + (floor as usize / 4).min(2)
    }
}
