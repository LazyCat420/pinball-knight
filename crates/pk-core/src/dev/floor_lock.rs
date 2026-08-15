//! Dev Floor Lock — Central funnel pinning dungeon descent target for level iteration and ghost maze tests.
//!
//! PORTS: `dev/floor-lock.ts`

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct DevFloorLock {
    pub locked_floor: Option<u32>,
    pub ghost_level: Option<u32>,
}

impl DevFloorLock {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_lock(&mut self, floor: Option<u32>) {
        self.locked_floor = floor.filter(|&f| f > 0);
    }

    pub fn set_ghost(&mut self, level: Option<u32>) {
        self.ghost_level = level.filter(|&l| l > 0);
    }

    /// Clamps descent target through active dev overrides with precedence: Ghost Maze > Floor Lock > Target.
    pub fn apply_floor_lock(&self, target: u32) -> (u32, Option<String>) {
        // Ghost Maze has strict priority (pins depth + seed together)
        if let Some(ghost) = self.ghost_level {
            let msg = if ghost != target {
                Some(format!("[ghost-maze] descent to {} -> {}", target, ghost))
            } else {
                None
            };
            return (ghost, msg);
        }

        // Bare Floor Lock pins depth alone
        if let Some(lock) = self.locked_floor {
            if lock != target {
                return (
                    lock,
                    Some(format!("[floor-lock] descent to {} -> {}", target, lock)),
                );
            }
        }

        (target, None)
    }
}
