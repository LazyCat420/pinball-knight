// Parity test suite for Ghost Maze Workbench Console Interface.
// Replicates legacy/src/game/pinball-knight/dev/ghost-command.ts

use pk_core::dev::ghost_command::{describe_ghost_maze, reroll_ghost_seed};

#[test]
fn describe_formats_state_appropriately() {
    assert_eq!(describe_ghost_maze(None, None), "OFF — playing the real game");
    assert_eq!(
        describe_ghost_maze(Some(3), Some(1337)),
        "Ghost Maze · depth 3 · seed 1337"
    );
    assert_eq!(describe_ghost_maze(Some(5), None), "Ghost Maze · depth 5");
}

#[test]
fn reroll_seed_progresses_incrementally() {
    let s0 = 100;
    let s1 = reroll_ghost_seed(s0);
    assert_eq!(s1, 101);

    let max_u32 = 0xffffffff;
    let wrapped = reroll_ghost_seed(max_u32);
    assert_eq!(wrapped, 0);
}
