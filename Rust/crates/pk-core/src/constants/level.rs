//! Dungeon floor progression budgets, grading thresholds, and level scaling.
//!
//! PORTS: `constants/level.ts`

use super::maze::{ROOMS_BASE, ROOMS_MAX, ROOMS_PER_LEVEL, SECRETS_BASE, SECRETS_MAX, SECRETS_PER_LEVEL};

// ── Floor grade + pinball style bonuses (the score glue) ────────
pub const STYLE_KILL_BASE_GOLD: i64 = 2;
pub const STYLE_KILL_COMBO_GOLD: i64 = 1;
pub const STYLE_KILL_GOLD_MAX: i64 = 12;
pub const GRADE_TIME_FAST: f64 = 75.0;
pub const GRADE_TIME_OK: f64 = 140.0;
pub const GRADE_KILLS_FULL: f64 = 0.6;
pub const GRADE_KILLS_OK: f64 = 0.25;
pub const GRADE_COMBO_FULL: i64 = 24;
pub const GRADE_COMBO_OK: i64 = 8;
pub const GRADE_FLOW_FULL: f64 = 0.3;
pub const GRADE_FLOW_OK: f64 = 0.15;

pub const GRADE_GOLD_S: i64 = 40;
pub const GRADE_GOLD_A: i64 = 25;
pub const GRADE_GOLD_B: i64 = 15;
pub const GRADE_GOLD_C: i64 = 8;
pub const GRADE_GOLD_D: i64 = 0;

pub fn grade_gold(grade: &str) -> i64 {
    match grade {
        "S" => GRADE_GOLD_S,
        "A" => GRADE_GOLD_A,
        "B" => GRADE_GOLD_B,
        "C" => GRADE_GOLD_C,
        _ => GRADE_GOLD_D,
    }
}

// ── Level scaling ───────────────────────────────────────────────
pub const WINDINESS_CYCLE: [f64; 3] = [1.0, 0.3, 0.65];

#[derive(Debug, Clone, PartialEq)]
pub struct LevelConfig {
    pub cells_w: i64,
    pub cells_h: i64,
    pub floor_tiles: i64,
    pub zombies: i64,
    pub zombie_speed: f64,
    pub torches: i64,
    pub braid: f64,
    pub windiness: f64,
    pub rooms: i64,
    pub secrets: i64,
    pub launch_breaks: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FloorBudgets {
    pub zombies: i64,
    pub torches: i64,
    pub parts_area: i64,
}

fn js_round(v: f64) -> f64 {
    (v + 0.5).floor()
}

pub fn floor_budgets(level: i64, walkable: f64) -> FloorBudgets {
    let l = level.max(1);
    let zombies = (js_round(walkable / 50.0) as i64 + 2 * (l - 1)).min(135);
    let torches = (js_round(walkable / 70.0) as i64 + 6).min(80);
    let parts_area = (walkable / 600.0).floor() as i64;
    FloorBudgets {
        zombies,
        torches,
        parts_area,
    }
}

pub fn level_config(level: i64) -> LevelConfig {
    let l = level.max(1);
    let cells_w = (34 + (l as f64 * 2.8).ceil() as i64).min(96);
    let cells_h = (24 + 2 * l).min(72);
    let floor_tiles = js_round(cells_w as f64 * cells_h as f64 * 2.5) as i64;
    let budgets = floor_budgets(l, floor_tiles as f64);
    let windiness = WINDINESS_CYCLE[((l - 1) as usize) % WINDINESS_CYCLE.len()];
    LevelConfig {
        cells_w,
        cells_h,
        floor_tiles,
        zombies: budgets.zombies,
        zombie_speed: (1.5 + 0.12 * l as f64).min(2.8),
        torches: budgets.torches,
        braid: (0.14 + 0.04 * l as f64).min(0.4),
        windiness,
        rooms: (ROOMS_BASE as i64 + (((l - 1) as f64 * ROOMS_PER_LEVEL as f64).floor() as i64)).min(ROOMS_MAX as i64),
        secrets: (SECRETS_BASE as i64 + (((l - 1) as f64 * SECRETS_PER_LEVEL as f64).floor() as i64)).min(SECRETS_MAX as i64),
        launch_breaks: (8 + (l - 1) / 2).min(16),
    }
}
