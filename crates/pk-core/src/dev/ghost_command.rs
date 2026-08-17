//! Ghost Maze Workbench Console Interface — Deterministic seed progression and status descriptions.
//!
//! PORTS-PARTIAL: `dev/ghost-command.ts` - NOT a finished port - 11 rust code lines against 53 legacy (21%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

use super::ghost_maze::GHOST_MAZE_NAME;

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
