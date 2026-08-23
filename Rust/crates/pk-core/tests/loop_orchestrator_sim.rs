// Parity test suite for Simulation Frame Loop Orchestrator.
// Replicates legacy/src/game/pinball-knight/sim/loop.ts

use pk_core::sim::loop_orchestrator::FrameLoopState;

#[test]
fn loop_orchestrator_tick_and_pause_gating() {
    let mut loop_state = FrameLoopState::new();

    let mut tick_count = 0;
    // Advance by 1/30 second (2 fixed 60Hz steps)
    let steps = loop_state.tick(1.0 / 30.0, || {
        tick_count += 1;
    });

    assert_eq!(steps, 2);
    assert_eq!(tick_count, 2);
    assert_eq!(loop_state.frames_presented, 1);
    assert!(loop_state.heat_time > 0.0);

    // Pause simulation
    loop_state.is_paused = true;
    let initial_heat = loop_state.heat_time;
    let paused_steps = loop_state.tick(1.0 / 30.0, || {
        tick_count += 1;
    });

    assert_eq!(paused_steps, 0);
    assert_eq!(tick_count, 2); // Unchanged
    assert!(loop_state.heat_time > initial_heat); // Real-time heat clock still advanced

    // Reset clock
    loop_state.reset_clock();
    assert_eq!(loop_state.accumulator, 0.0);
}
