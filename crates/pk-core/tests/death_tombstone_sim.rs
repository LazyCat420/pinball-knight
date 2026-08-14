// Parity test suite for Player Death, Tombstone Recovery, and Level Constants.
// Replicates legacy/src/game/pinball-knight/run/death.ts and constants/level.ts

use pk_core::constants::level::{is_boss_floor, level_chests_count, level_grid_size, level_horde_budget};
use pk_core::run::death::{claim_tombstone, handle_player_death};

#[test]
fn player_death_creates_tombstone_and_deducts_resources() {
    let (mut tombstone, retained_gold, retained_souls) =
        handle_player_death(3, 15.0, 25.0, 100, 50);

    assert_eq!(tombstone.floor, 3);
    assert_eq!(tombstone.x, 15.0);
    assert_eq!(tombstone.z, 25.0);
    assert_eq!(tombstone.gold, 50);
    assert_eq!(tombstone.souls, 50);
    assert!(!tombstone.claimed);

    assert_eq!(retained_gold, 50);
    assert_eq!(retained_souls, 0);

    // Far from tombstone -> cannot claim
    let far_claim = claim_tombstone(&mut tombstone, 50.0, 50.0);
    assert!(far_claim.is_none());
    assert!(!tombstone.claimed);

    // Close to tombstone -> successfully claimed
    let near_claim = claim_tombstone(&mut tombstone, 15.2, 25.1);
    assert_eq!(near_claim, Some((50, 50)));
    assert!(tombstone.claimed);

    // Subsequent claim returns None (already claimed)
    let duplicate_claim = claim_tombstone(&mut tombstone, 15.0, 25.0);
    assert!(duplicate_claim.is_none());
}

#[test]
fn level_progression_constants_and_scaling() {
    assert_eq!(level_horde_budget(1), 14);
    assert_eq!(level_horde_budget(2), 17);
    assert_eq!(level_horde_budget(5), 26);

    assert_eq!(level_grid_size(2), (24, 24));
    assert_eq!(level_grid_size(6), (28, 28));
    assert_eq!(level_grid_size(10), (32, 32));

    assert!(is_boss_floor(5));
    assert!(is_boss_floor(10));
    assert!(!is_boss_floor(4));

    assert_eq!(level_chests_count(5), 3);
    assert_eq!(level_chests_count(1), 1);
}
