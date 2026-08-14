//! Descent reward calculation and floor completion grading.
//!
//! PORTS: `run/descend.ts`

pub const GOLD_PER_DESCENT: u32 = 25;
pub const BOSS_GOLD: u32 = 150;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DescendReward {
    pub gold_reward: u32,
    pub bonus_gold: u32,
    pub grade_letter: &'static str,
    pub total_gold: u32,
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
