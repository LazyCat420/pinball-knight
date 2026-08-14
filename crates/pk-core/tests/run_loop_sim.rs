// Parity test for Dungeon Run State Machine, Floor Progression, and Scoring.
// Replicates legacy/src/game/pinball-knight/state.ts

use pk_core::player::types::PlayerCoreState;
use pk_core::rng::Mulberry32;
use pk_core::run::state_machine::{resolve_draft_choice, step_run_state_machine, DungeonRun, RunEvent};
use pk_core::run::types::{FloorPhase, RunSummary};

#[test]
fn run_progresses_through_floor_lifecycle_to_victory() {
    let mut run = DungeonRun::default();
    let mut player = PlayerCoreState::default();
    let mut prng = Mulberry32::new(42);

    assert_eq!(run.phase, FloorPhase::ChuteLaunch);

    // 1. Plunger launches -> Exploring
    player.plunger.launched = true;
    let _ = step_run_state_machine(&mut run, &player, 10, false, &mut prng, 0.016);
    assert_eq!(run.phase, FloorPhase::Exploring);

    // 2. Clear all monsters -> FloorCleared -> CardDraft
    let _ = step_run_state_machine(&mut run, &player, 0, false, &mut prng, 0.016);
    assert_eq!(run.phase, FloorPhase::FloorCleared);
    let event = step_run_state_machine(&mut run, &player, 0, false, &mut prng, 0.016);
    assert_eq!(run.phase, FloorPhase::CardDraft);
    assert!(matches!(event, RunEvent::DraftAvailable));
    assert!(run.active_draft.is_some());

    // 3. Draft choice picked -> DescentStairs
    let chosen_card = resolve_draft_choice(&mut run, 0);
    assert!(chosen_card.is_some());
    assert_eq!(run.phase, FloorPhase::DescentStairs);

    // 4. Reach stairs on floor 1 -> Descend to floor 2
    let event = step_run_state_machine(&mut run, &player, 0, true, &mut prng, 0.016);
    assert!(matches!(event, RunEvent::DescendFloor(2)));
    assert_eq!(run.summary.floor_level, 2);
}

#[test]
fn run_scoring_evaluates_grades_correctly() {
    let mut summary = RunSummary::default();
    summary.floor_level = 5;
    summary.kills = 80;
    summary.gold_earned = 500;
    summary.max_combo = 25;
    summary.elapsed_seconds = 180.0;
    summary.is_victory = true;

    let score = summary.calculate_score();
    assert!(score > 20000);
    assert_eq!(summary.calculate_grade(), "S");
}

#[test]
fn player_death_triggers_game_over() {
    let mut run = DungeonRun::default();
    let mut player = PlayerCoreState::default();
    let mut prng = Mulberry32::new(123);

    player.hp = 0;
    let event = step_run_state_machine(&mut run, &player, 5, false, &mut prng, 0.016);

    assert_eq!(run.phase, FloorPhase::GameOver);
    assert!(matches!(event, RunEvent::GameOver(_)));
}
