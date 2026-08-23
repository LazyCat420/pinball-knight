//! Ghost Maze Workbench Console Interface — Deterministic seed progression and status descriptions.
//!
//! PORTS: `dev/ghost-command.ts`

use super::ghost_maze::GHOST_MAZE_NAME;

#[derive(Clone, Debug, PartialEq)]
pub struct GhostCommand {
    pub level: Option<u32>,
    pub seed: Option<u64>,
    pub active: bool,
}

impl Default for GhostCommand {
    fn default() -> Self {
        Self {
            level: None,
            seed: None,
            active: false,
        }
    }
}

pub fn make_ghost_command() -> GhostCommand {
    GhostCommand::default()
}

/// Formats the current ghost maze workbench state for display.
pub fn describe_ghost_maze(level: Option<u32>, seed: Option<u64>) -> String {
    match (level, seed) {
        (Some(l), Some(s)) => format!("{} · depth {} · seed {}", GHOST_MAZE_NAME, l, s),
        (Some(l), None) => format!("{} · depth {}", GHOST_MAZE_NAME, l),
        _ => "OFF — playing the real game".to_string(),
    }
}

/// Computes the next deterministic seed for sequential floor iteration.
pub fn reroll_ghost_seed(current_seed: u64) -> u64 {
    (current_seed + 1) & 0xffffffff
}
