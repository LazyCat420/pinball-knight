// Parity test suite for Simulation Pause Contract.
// Replicates legacy/src/game/pinball-knight/sim/paused.ts

use pk_core::sim::paused::{is_sim_paused, PauseState};

#[test]
fn sim_pause_evaluates_ui_and_tavern_modal_state() {
    let unpaused = PauseState::new(false, false);
    assert!(!unpaused.is_sim_paused());
    assert!(!is_sim_paused(false, false));

    let ui_paused = PauseState::new(true, false);
    assert!(ui_paused.is_sim_paused());
    assert!(is_sim_paused(true, false));

    let tavern_paused = PauseState::new(false, true);
    assert!(tavern_paused.is_sim_paused());
    assert!(is_sim_paused(false, true));

    let both_paused = PauseState::new(true, true);
    assert!(both_paused.is_sim_paused());
    assert!(is_sim_paused(true, true));
}
