// Parity test suite for Gameplay Input Buffer, FPS Tracker, Engine Profiler and Config.
// Replicates legacy/src/game/pinball-knight/engine/input.ts, fps.ts, profiler.ts, config.ts

use pk_core::config::EngineConfig;
use pk_core::fps::FpsTracker;
use pk_core::input::{GameplayInputState, InputAction};
use pk_core::profiler::EngineProfiler;

#[test]
fn gameplay_input_buffers_action_and_expires() {
    let mut state = GameplayInputState::new();

    state.press_action(InputAction::MeleeSlash);
    assert_eq!(state.action_buffer.len(), 1);

    // Consume within active buffer window
    assert!(state.consume_action(InputAction::MeleeSlash));
    assert_eq!(state.action_buffer.len(), 0);

    // Press again and wait beyond 0.15s buffer window -> expires
    state.press_action(InputAction::DashRoll);
    state.step(0.20);
    assert!(!state.consume_action(InputAction::DashRoll));
}

#[test]
fn gameplay_movement_heading_is_normalized() {
    let mut state = GameplayInputState::new();

    state.press_action(InputAction::MoveRight);
    assert_eq!(state.move_dir, (1.0, 0.0));

    state.press_action(InputAction::MoveDown);
    let (dx, dz) = state.move_dir;
    assert!((dx - 0.7071).abs() < 0.01);
    assert!((dz - 0.7071).abs() < 0.01);
}

#[test]
fn fps_tracker_computes_rolling_rate_and_hitches() {
    let mut tracker = FpsTracker::new();

    // 60 standard 16.67ms frames
    for _ in 0..60 {
        tracker.record_frame(0.01667);
    }

    assert!((tracker.fps - 60.0).abs() < 1.0);
    assert_eq!(tracker.hitch_count, 0);

    // 1 hitch frame of 50ms
    tracker.record_frame(0.050);
    assert_eq!(tracker.hitch_count, 1);
}

#[test]
fn engine_profiler_and_config() {
    let config = EngineConfig::default();
    assert_eq!(config.fixed_timestep_hz, 60);
    assert!((config.fixed_dt() - 0.016666).abs() < 0.001);

    let mut profiler = EngineProfiler::new();
    profiler.record_stage("simulate", 2.5);
    profiler.record_stage("paint", 4.1);

    assert_eq!(profiler.stages.get("simulate").unwrap().current_ms, 2.5);
    assert_eq!(profiler.stages.get("paint").unwrap().current_ms, 4.1);
}
