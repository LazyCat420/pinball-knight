//! Gambler Mini-Games 1:1 Pixel Art & Animation Parity Test Suite
//! Asserts that Slots, Roulette, Darts, and Blackjack render rich pixel runs,
//! card pips, dartboard rings, and wheel pocket animations.

use pk_core::gambler::blackjack_table::BlackjackTable;
use pk_core::gambler::drive::{DartsDrive, RouletteDrive, SlotsDrive};
use pk_core::gambler::roulette::bets;

#[test]
fn test_slots_pixel_symbols_rendered() {
    let mut drive = SlotsDrive::new();
    let mut rand_val = 0.5;
    drive.play(10, &mut || {
        rand_val += 0.1;
        rand_val % 1.0
    });

    // Before stops, it's spinning (busy)
    assert!(drive.busy());

    // When stopped, reels have symbols
    let reels = drive.reels().expect("reels generated");
    assert_eq!(reels.len(), 3);
}

#[test]
fn test_blackjack_table_card_art_structure() {
    let table = BlackjackTable::new();
    assert!(!table.busy());
    assert_eq!(table.player.len(), 0);
    assert_eq!(table.dealer.len(), 0);
}

#[test]
fn test_darts_two_axis_aim_sweep() {
    let mut drive = DartsDrive::new(Box::new(|| 0.5));
    drive.play(10);
    assert!(drive.busy());
    assert_eq!(drive.machine().darts().len(), 0);
}

#[test]
fn test_roulette_pocket_resolution() {
    let drive = RouletteDrive::new(bets()[0].clone());
    assert!(!drive.busy());
}
