//! Descent reward calculation and floor completion grading.
//!
//! PORTS: `run/descend.ts`

use std::sync::atomic::{AtomicU32, Ordering};

pub const GOLD_PER_DESCENT: u32 = 25;
pub const BOSS_GOLD: u32 = 150;

static CURRENT_FLOOR: AtomicU32 = AtomicU32::new(1);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DescendReward {
    pub gold_reward: u32,
    pub bonus_gold: u32,
    pub grade_letter: &'static str,
    pub total_gold: u32,
}

pub fn drop_boss_reward(_x: f64, _z: f64) {}

pub fn descend_into(explicit: Option<u32>) -> u32 {
    let next = explicit.unwrap_or_else(|| CURRENT_FLOOR.load(Ordering::Relaxed) + 1);
    CURRENT_FLOOR.store(next, Ordering::Relaxed);
    next
}

pub fn grant_delve_boon(_target: u32) {}

pub fn regroup_with_pool_when_they_land(_started_on_level: u32) {}

pub fn adopt_pool_seed_when_it_arrives(_started_on_level: u32) {}

pub fn descend() {
    descend_into(None);
}

/// Evaluates floor clear performance and calculates awarded gold rewards.
pub fn calculate_descent_rewards(
    _floor: u32,
    is_boss: bool,
    kills: u32,
    target_kills: u32,
    time_taken: f64,
    par_time: f64,
) -> DescendReward {
    let base_gold = GOLD_PER_DESCENT;
    let boss_gold = if is_boss { BOSS_GOLD } else { 0 };

    let (grade_letter, grade_bonus) = if kills >= target_kills && time_taken <= par_time {
        ("S", 50)
    } else if kills >= target_kills || time_taken <= par_time {
        ("A", 25)
    } else if kills >= (target_kills / 2).max(1) {
        ("B", 10)
    } else {
        ("C", 0)
    };

    let total = base_gold + boss_gold + grade_bonus;

    DescendReward {
        gold_reward: base_gold,
        bonus_gold: boss_gold + grade_bonus,
        grade_letter,
        total_gold: total,
    }
}
