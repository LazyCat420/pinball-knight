// Parity test suite for Dungeon Run Telemetry Ledger.
// Replicates legacy/src/game/pinball-knight/run/ledger.ts

use pk_core::run::ledger::{begin_run_ledger, record_combo, record_floor_reached};

#[test]
fn begin_run_ledger_initializes_roguelite_state() {
    let ledger = begin_run_ledger(1000.0, false);
    assert_eq!(ledger.deepest_floor, 1);
    assert_eq!(ledger.best_combo, 0);
    assert_eq!(ledger.char_level, 1);
    assert_eq!(ledger.char_xp, 0);
    assert_eq!(ledger.skill_points, 0);
    assert_eq!(
        ledger.unlocked_abilities,
        vec!["flippercharge".to_string(), "arcanepulse".to_string()]
    );
    assert_eq!(ledger.card_stash.len(), 0);
}

#[test]
fn pack_rat_perk_seeds_starting_card() {
    let ledger = begin_run_ledger(1000.0, true);
    assert_eq!(ledger.card_stash.len(), 1);
    assert!(ledger.card_stash[0].contains("card_iron_nail"));
}

#[test]
fn telemetry_records_deepest_floor_and_combos_monotonically() {
    let mut ledger = begin_run_ledger(0.0, false);

    record_floor_reached(&mut ledger, 3);
    assert_eq!(ledger.deepest_floor, 3);
    record_floor_reached(&mut ledger, 2); // Lower floor does not decrement
    assert_eq!(ledger.deepest_floor, 3);

    record_combo(&mut ledger, 15);
    assert_eq!(ledger.best_combo, 15);
    record_combo(&mut ledger, 10);
    assert_eq!(ledger.best_combo, 15);
}
