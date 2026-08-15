// Parity test suite for Sealed Vault Lamp Puzzle Runtime.
// Replicates legacy/src/game/pinball-knight/lamp-puzzle.ts

use pk_core::maze::lamp_runtime::{
    LampRuntimeState, CHEST_LIT, CHEST_OPEN, CHEST_UNLIT,
};

#[test]
fn lamp_puzzle_progressively_lights_and_unlocks_vault() {
    let mut puzzle = LampRuntimeState::new(3, 10, 10, 100.0, 100.0);

    assert_eq!(puzzle.lit, 0);
    assert!(!puzzle.is_solved());
    assert_eq!(puzzle.chest.emissive_hex, CHEST_UNLIT);

    // Lamp 0 hit
    assert!(puzzle.light_lamp(0));
    assert_eq!(puzzle.lit, 1);
    assert!(!puzzle.is_solved());
    assert_eq!(puzzle.chest.emissive_hex, CHEST_LIT);

    // Duplicate hit on Lamp 0 is debounced
    assert!(!puzzle.light_lamp(0));
    assert_eq!(puzzle.lit, 1);

    // Lamp 1 hit
    assert!(puzzle.light_lamp(1));
    assert_eq!(puzzle.lit, 2);
    assert!(!puzzle.is_solved());

    // Lamp 2 (final) hit -> Unlock!
    assert!(puzzle.light_lamp(2));
    assert_eq!(puzzle.lit, 3);
    assert!(puzzle.is_solved());
    assert_eq!(puzzle.chest.emissive_hex, CHEST_OPEN);
    assert!(puzzle.chest.open);
}
