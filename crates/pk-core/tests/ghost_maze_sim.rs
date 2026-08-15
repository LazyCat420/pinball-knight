// Parity test suite for Ghost Maze Named Workbench Floor.
// Replicates legacy/src/game/pinball-knight/dev/ghost-maze.ts

use pk_core::dev::ghost_maze::{GhostMaze, GhostMazeStore, DEFAULT_LEVEL, DEFAULT_SEED};

#[test]
fn ghost_maze_workbench_store_lifecycle() {
    let mut store = GhostMazeStore::new();
    assert_eq!(store.get(), None);
    assert_eq!(store.seed(), None);
    assert_eq!(store.apply_level(1), 1);
    assert_eq!(store.floor_label(), None);

    // Enter with default parameters
    let g = store.enter(None, None);
    assert_eq!(
        g,
        GhostMaze {
            level: DEFAULT_LEVEL,
            seed: DEFAULT_SEED,
        }
    );
    assert_eq!(store.apply_level(1), 5);
    assert_eq!(store.seed(), Some(DEFAULT_SEED));
    assert_eq!(
        store.floor_label(),
        Some("GHOST MAZE · d5 · #24663".to_string())
    );

    // Pin custom level and seed
    store.enter(Some(3), Some(0x1234));
    assert_eq!(store.apply_level(1), 3);
    assert_eq!(store.seed(), Some(0x1234));
    assert_eq!(
        store.floor_label(),
        Some("GHOST MAZE · d3 · #4660".to_string())
    );

    // Clear pin
    store.clear();
    assert_eq!(store.get(), None);
    assert_eq!(store.apply_level(1), 1);
    assert_eq!(store.floor_label(), None);
}
