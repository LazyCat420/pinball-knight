// Parity test suite for Persistent Legacy Perks Store.
// Replicates legacy/src/game/pinball-knight/legacy.ts

use pk_core::run::legacy::{LegacyStore, LEGACY_PERKS};

#[test]
fn legacy_store_caps_ranks_at_max_rank() {
    let mut store = LegacyStore::new();

    // Old scar max rank is 1
    assert_eq!(store.perk_rank("oldscar"), 0);
    assert_eq!(store.add_perk_rank("oldscar"), 1);
    assert_eq!(store.add_perk_rank("oldscar"), 1); // Capped at 1

    // Veteran max rank is 2
    assert_eq!(store.perk_rank("veteran"), 0);
    assert_eq!(store.add_perk_rank("veteran"), 1);
    assert_eq!(store.add_perk_rank("veteran"), 2);
    assert_eq!(store.add_perk_rank("veteran"), 2); // Capped at 2
}

#[test]
fn pack_rat_perk_activates_starter_card_flag() {
    let mut store = LegacyStore::new();
    assert!(!store.has_start_card_perk());

    store.add_perk_rank("packrat");
    assert!(store.has_start_card_perk());
}

#[test]
fn all_perks_have_valid_authored_costs() {
    for perk in LEGACY_PERKS {
        assert!(perk.cost > 0);
        assert!(perk.max_rank > 0);
        assert!(!perk.description.is_empty());
    }
}
