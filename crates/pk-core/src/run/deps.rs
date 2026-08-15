//! Run Lifecycle Dependency Injection Gateway — Decoupled lifecycle re-entry functions.
//!
//! PORTS: `run/deps.ts`

#[derive(Clone, Copy, Debug)]
pub struct RunDeps {
    pub start_level: fn(u32),
    pub arm_floor_loading: fn(u32),
    pub exit_dungeon_game: fn(),
}

#[derive(Clone, Copy, Debug, Default)]
pub struct RunLifecycleGateway {
    deps: Option<RunDeps>,
}

impl RunLifecycleGateway {
    pub fn new() -> Self {
        Self::default()
    }

    /// Injects the core lifecycle callbacks. Called once during game launch.
    pub fn set_deps(&mut self, deps: RunDeps) {
        self.deps = Some(deps);
    }

    /// Invokes start_level to build and enter a floor. Panics if unwired.
    pub fn start_level(&self, level: u32) {
        let deps = self
            .deps
            .expect("run/deps: set_deps() was never called — the lifecycle is unwired");
        (deps.start_level)(level);
    }

    /// Invokes arm_floor_loading to raise the descent loading screen. Panics if unwired.
    pub fn arm_floor_loading(&self, level: u32) {
        let deps = self
            .deps
            .expect("run/deps: set_deps() was never called — the lifecycle is unwired");
        (deps.arm_floor_loading)(level);
    }

    /// Invokes exit_dungeon_game for full session teardown. Panics if unwired.
    pub fn exit_dungeon_game(&self) {
        let deps = self
            .deps
            .expect("run/deps: set_deps() was never called — the lifecycle is unwired");
        (deps.exit_dungeon_game)();
    }
}
