// Parity test suite for Leaderboard Run Scoring Formula.
// Replicates legacy/src/game/pinball-knight/run-score.ts

use pk_core::run::score::{run_detail, score_run, RunStats, SCORE_PER_FLOOR};

#[test]
fn floor_one_death_with_zero_kills_scores_base_floor_points() {
    let stats = RunStats {
        deepest_floor: 1,
        best_combo: 0,
        kills: 0,
        gold: 0,
        duration_s: 12.0,
        named_shots: 0,
        orbit_laps: 0,
        jackpots: 0,
        best_flow: 0.0,
        flawless_floors: 0,
    };

    assert_eq!(score_run(&stats), SCORE_PER_FLOOR);
}

#[test]
fn scoring_evaluates_all_tiebreaker_components() {
    let stats = RunStats {
        deepest_floor: 4,     // 4000
        best_combo: 10,       // 500
        kills: 20,            // 500
        gold: 150,            // 150
        duration_s: 180.0,
        named_shots: 2,       // 200
        orbit_laps: 3,        // 180
        jackpots: 1,          // 80
        best_flow: 0.5,       // 150 (0.5 * 300)
        flawless_floors: 1,   // 200
    };

    // 4000 + 500 + 500 + 150 + 200 + 180 + 80 + 150 + 200 = 5960
    assert_eq!(score_run(&stats), 5960);

    let detail = run_detail(&stats);
    assert_eq!(detail.floor, 4);
    assert_eq!(detail.combo, 10);
    assert_eq!(detail.kills, 20);
    assert_eq!(detail.gold, 150);
    assert_eq!(detail.seconds, 180);
    assert_eq!(detail.shots, 2);
    assert_eq!(detail.laps, 3);
    assert_eq!(detail.jackpots, 1);
    assert_eq!(detail.flow, 50); // 50%
    assert_eq!(detail.flawless, 1);
}
