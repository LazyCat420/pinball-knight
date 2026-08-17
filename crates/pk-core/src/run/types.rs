//! Run progression, floor phases, and scoring.
//!
//! PORTS-NOTHING

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FloorPhase {
    ChuteLaunch,
    Exploring,
    BossEncounter,
    FloorCleared,
    CardDraft,
    DescentStairs,
    GameOver,
    Victory,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RunSummary {
    pub floor_level: u32,
    pub max_floor: u32,
    pub kills: u32,
    pub gold_earned: i64,
    pub max_combo: u32,
    pub elapsed_seconds: f64,
    pub is_victory: bool,
}

impl Default for RunSummary {
    fn default() -> Self {
        Self {
            floor_level: 1,
            max_floor: 5,
            kills: 0,
            gold_earned: 0,
            max_combo: 0,
            elapsed_seconds: 0.0,
            is_victory: false,
        }
    }
}

impl RunSummary {
    pub fn calculate_score(&self) -> u64 {
        let floor_score = (self.floor_level as u64) * 1000;
        let kill_score = (self.kills as u64) * 50;
        let gold_score = (self.gold_earned.max(0) as u64) * 10;
        let combo_bonus = (self.max_combo as u64) * 100;
        let time_penalty = (self.elapsed_seconds as u64) * 2;
        let win_bonus = if self.is_victory { 10000 } else { 0 };

        (floor_score + kill_score + gold_score + combo_bonus + win_bonus)
            .saturating_sub(time_penalty)
    }

    pub fn calculate_grade(&self) -> &'static str {
        let score = self.calculate_score();
        if score >= 20000 {
            "S"
        } else if score >= 14000 {
            "A"
        } else if score >= 8000 {
            "B"
        } else if score >= 4000 {
            "C"
        } else {
            "D"
        }
    }
}
