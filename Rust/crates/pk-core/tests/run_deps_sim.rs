// Parity test suite for Run Lifecycle Dependency Injection Gateway.
// Replicates legacy/src/game/pinball-knight/run/deps.ts

use pk_core::run::deps::{RunDeps, RunLifecycleGateway};
use std::sync::atomic::{AtomicU32, Ordering};

static LEVEL_CALLED: AtomicU32 = AtomicU32::new(0);
static LOAD_CALLED: AtomicU32 = AtomicU32::new(0);
static EXIT_CALLED: AtomicU32 = AtomicU32::new(0);

fn mock_start_level(level: u32) {
    LEVEL_CALLED.store(level, Ordering::SeqCst);
}

fn mock_arm_loading(level: u32) {
    LOAD_CALLED.store(level, Ordering::SeqCst);
}

fn mock_exit() {
    EXIT_CALLED.store(1, Ordering::SeqCst);
}

#[test]
fn run_deps_dispatches_when_wired() {
    let mut gateway = RunLifecycleGateway::new();
    gateway.set_deps(RunDeps {
        start_level: mock_start_level,
        arm_floor_loading: mock_arm_loading,
        exit_dungeon_game: mock_exit,
    });

    gateway.start_level(4);
    assert_eq!(LEVEL_CALLED.load(Ordering::SeqCst), 4);

    gateway.arm_floor_loading(5);
    assert_eq!(LOAD_CALLED.load(Ordering::SeqCst), 5);

    gateway.exit_dungeon_game();
    assert_eq!(EXIT_CALLED.load(Ordering::SeqCst), 1);
}

#[test]
#[should_panic(expected = "the lifecycle is unwired")]
fn run_deps_panics_when_unwired() {
    let gateway = RunLifecycleGateway::new();
    gateway.start_level(1);
}
