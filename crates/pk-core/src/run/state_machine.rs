//! Run progression state machine and floor lifecycle.
//!
//! PORTS: `state.ts`

use super::draft::{generate_draft_offer, DraftOffer};
use super::types::{FloorPhase, RunSummary};
use crate::player::types::PlayerCoreState;
use crate::rng::Mulberry32;

#[derive(Debug, Clone, PartialEq)]
pub struct DungeonRun {
    pub phase: FloorPhase,
    pub summary: RunSummary,
    pub active_draft: Option<DraftOffer>,
    pub phase_timer: f64,
}

impl Default for DungeonRun {
    fn default() -> Self {
        Self {
            phase: FloorPhase::ChuteLaunch,
            summary: RunSummary::default(),
            active_draft: None,
            phase_timer: 0.0,
        }
    }
}

pub enum RunEvent {
    None,
    DraftAvailable,
    DescendFloor(u32),
    GameOver(RunSummary),
    Victory(RunSummary),
}

/// Advances dungeon run state machine at 60 Hz.
pub fn step_run_state_machine(
    run: &mut DungeonRun,
    player: &PlayerCoreState,
    monsters_alive: usize,
    at_stairs: bool,
    prng: &mut Mulberry32,
    dt: f64,
) -> RunEvent {
    run.summary.elapsed_seconds += dt;
    run.phase_timer += dt;

    if player.hp <= 0 && run.phase != FloorPhase::GameOver {
        run.phase = FloorPhase::GameOver;
        return RunEvent::GameOver(run.summary.clone());
    }

    match run.phase {
        FloorPhase::ChuteLaunch => {
            if player.plunger.launched || run.phase_timer > 2.0 {
                run.phase = FloorPhase::Exploring;
                run.phase_timer = 0.0;
            }
        }
        FloorPhase::Exploring => {
            if monsters_alive == 0 {
                run.phase = FloorPhase::FloorCleared;
                run.phase_timer = 0.0;
            }
        }
        FloorPhase::FloorCleared => {
            let offer = generate_draft_offer(run.summary.floor_level, prng);
            run.active_draft = Some(offer);
            run.phase = FloorPhase::CardDraft;
            return RunEvent::DraftAvailable;
        }
        FloorPhase::CardDraft => {
            // Waiting for user pick via select_draft_choice
        }
        FloorPhase::DescentStairs => {
            if at_stairs {
                run.summary.floor_level += 1;
                if run.summary.floor_level > run.summary.max_floor {
                    run.phase = FloorPhase::Victory;
                    run.summary.is_victory = true;
                    return RunEvent::Victory(run.summary.clone());
                } else {
                    run.phase = FloorPhase::ChuteLaunch;
                    run.phase_timer = 0.0;
                    return RunEvent::DescendFloor(run.summary.floor_level);
                }
            }
        }
        FloorPhase::BossEncounter | FloorPhase::GameOver | FloorPhase::Victory => {}
    }

    RunEvent::None
}

/// Resolves card draft selection and opens the stairs to descend.
pub fn resolve_draft_choice(run: &mut DungeonRun, choice_index: usize) -> Option<&'static str> {
    if run.phase != FloorPhase::CardDraft {
        return None;
    }
    let chosen_card = if let Some(offer) = &run.active_draft {
        let idx = choice_index.min(2);
        Some(offer.choices[idx].card_id)
    } else {
        None
    };

    run.active_draft = None;
    run.phase = FloorPhase::DescentStairs;
    chosen_card
}
