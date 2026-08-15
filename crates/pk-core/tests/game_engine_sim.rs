// Parity test suite for Game Engine Seam and Fixed Step Loop.
// Replicates legacy/src/game/pinball-knight/GameEngine.ts

use pk_core::game_engine::{install_engine, FixedStepLoop};

#[test]
fn fixed_step_loop_accumulator_and_hitstop() {
    assert!(install_engine());

    let mut loop_clock = FixedStepLoop::new();
    assert_eq!(loop_clock.accumulator, 0.0);

    // Add 1/30 second (approx 2 ticks of 1/60)
    loop_clock.add_time(1.0 / 30.0);
    assert!(loop_clock.step());
    assert!(loop_clock.step());
    assert!(!loop_clock.step()); // No more ticks

    // Trigger hitstop freeze of 0.05 seconds
    loop_clock.trigger_hitstop(0.05);
    loop_clock.add_time(0.04);
    assert_eq!(loop_clock.accumulator, 0.0); // Frozen, accumulator does not increase

    // Finish freeze duration
    loop_clock.add_time(0.02);
    assert_eq!(loop_clock.freeze_timer, 0.0);
}
