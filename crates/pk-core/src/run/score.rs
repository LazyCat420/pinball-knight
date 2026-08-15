//! Run scoring for the leaderboard — Depth dominates, with combos, shots, laps, and flawless floors as tiebreakers.
//!
//! PORTS: `run-score.ts`

pub const SCORE_PER_FLOOR: u64 = 1000;
pub const SCORE_PER_COMBO: u64 = 50;
pub const SCORE_PER_KILL: u64 = 25;
pub const SCORE_PER_GOLD: u64 = 1;
pub const SCORE_PER_NAMED_SHOT: u64 = 100;
pub const SCORE_PER_ORBIT_LAP: u64 = 60;
pub const SCORE_PER_JACKPOT: u64 = 80;
pub const SCORE_PER_FLOW: f64 = 300.0;
pub const SCORE_PER_FLAWLESS: u64 = 200;

#[derive(Clone, Debug, PartialEq, Default)]
pub struct RunStats {
    pub deepest_floor: u32,
    pub best_combo: u32,
    pub kills: u32,
    pub gold: u32,
    pub duration_s: f64,
    pub named_shots: u32,
    pub orbit_laps: u32,
    pub jackpots: u32,
    pub best_flow: f64,
    pub flawless_floors: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct RunDetailRecord {
    pub floor: u32,
    pub combo: u32,
    pub kills: u32,
    pub gold: u32,
    pub seconds: u32,
    pub shots: u32,
    pub laps: u32,
    pub jackpots: u32,
    pub flow: u32,
    pub flawless: u32,
}

/// Scores a finished run. Floor-1 death with 0 kills still scores SCORE_PER_FLOOR.
pub fn score_run(s: &RunStats) -> u64 {
    let flow_clamped = s.best_flow.clamp(0.0, 1.0);
    let flow_points = (flow_clamped * SCORE_PER_FLOW).round() as u64;

    let base = (s.deepest_floor as u64 * SCORE_PER_FLOOR)
        + (s.best_combo as u64 * SCORE_PER_COMBO)
        + (s.kills as u64 * SCORE_PER_KILL)
        + (s.gold as u64 * SCORE_PER_GOLD)
        + (s.named_shots as u64 * SCORE_PER_NAMED_SHOT)
        + (s.orbit_laps as u64 * SCORE_PER_ORBIT_LAP)
        + (s.jackpots as u64 * SCORE_PER_JACKPOT)
        + flow_points
        + (s.flawless_floors as u64 * SCORE_PER_FLAWLESS);

    base
}

/// The detail record stored alongside the score payload.
pub fn run_detail(s: &RunStats) -> RunDetailRecord {
    RunDetailRecord {
        floor: s.deepest_floor,
        combo: s.best_combo,
        kills: s.kills,
        gold: s.gold,
        seconds: s.duration_s.round().max(0.0) as u32,
        shots: s.named_shots,
        laps: s.orbit_laps,
        jackpots: s.jackpots,
        flow: (s.best_flow.clamp(0.0, 1.0) * 100.0).round() as u32,
        flawless: s.flawless_floors,
    }
}
