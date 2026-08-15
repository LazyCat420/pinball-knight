//! GHOST MAZE — The named workbench floor with pinned depth and seed.
//!
//! PORTS: `dev/ghost-maze.ts`

use serde::{Deserialize, Serialize};

pub const DEFAULT_LEVEL: u32 = 5;
pub const DEFAULT_SEED: u32 = 0x6057;
pub const GHOST_MAZE_NAME: &str = "GHOST MAZE";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GhostMaze {
    pub level: u32,
    pub seed: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct GhostMazeStore {
    pub pinned: Option<GhostMaze>,
}

impl GhostMazeStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// The pinned floor, or None when the real game is running.
    pub fn get(&self) -> Option<GhostMaze> {
        self.pinned
    }

    pub fn set(&mut self, next: Option<GhostMaze>) -> Option<GhostMaze> {
        self.pinned = next.filter(|g| g.level > 0);
        self.pinned
    }

    /// Turn it on, filling in whatever was not given from the current pin.
    pub fn enter(&mut self, level: Option<u32>, seed: Option<u32>) -> GhostMaze {
        let cur = self.get();
        let next = GhostMaze {
            level: level.or_else(|| cur.map(|c| c.level)).unwrap_or(DEFAULT_LEVEL),
            seed: seed.or_else(|| cur.map(|c| c.seed)).unwrap_or(DEFAULT_SEED),
        };
        self.set(Some(next));
        next
    }

    /// The pinned run seed, or None when the real game is running.
    pub fn seed(&self) -> Option<u32> {
        self.pinned.map(|g| g.seed)
    }

    /// The depth to start at. Identity when the pin is off.
    pub fn apply_level(&self, drawn: u32) -> u32 {
        match self.pinned {
            Some(g) => g.level,
            None => drawn,
        }
    }

    /// What to call this floor on screen.
    pub fn floor_label(&self) -> Option<String> {
        self.pinned
            .map(|g| format!("{} · d{} · #{}", GHOST_MAZE_NAME, g.level, g.seed))
    }

    /// Turn off ghost maze pinning.
    pub fn clear(&mut self) {
        self.pinned = None;
    }
}
