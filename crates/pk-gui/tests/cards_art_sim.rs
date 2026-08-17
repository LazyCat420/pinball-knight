// Parity test suite for Pixel Playing Cards Art Engine.
// Replicates legacy/src/scenes/tavern/gambler/cards-art.ts

use pk_gui::gambler::cards_art::{rank_bitmap_3x5, rotate_180_3x5, suit_pip_5x5, suit_pip_7x7};

#[test]
fn cards_art_rank_bitmaps_and_180_inversion() {
    let ace = rank_bitmap_3x5("A");
    assert_eq!(ace[1], 1); // Top middle
    assert_eq!(ace[12], 1); // Bottom left

    let ace_rot = rotate_180_3x5(&ace);
    assert_eq!(ace_rot[13], 1); // Inverted top middle lands at bottom middle
    assert_eq!(ace_rot[2], 1); // Inverted bottom left lands at top right

    let seven = rank_bitmap_3x5("7");
    assert_eq!(seven[0..3], [1, 1, 1]); // Top bar
}

#[test]
fn cards_art_suit_pips_coverage() {
    for suit in ["heart", "diamond", "spade", "club"] {
        let pip5 = suit_pip_5x5(suit);
        assert!(pip5.iter().any(|&c| c == 1));

        let pip7 = suit_pip_7x7(suit);
        assert!(pip7.iter().any(|&c| c == 1));
    }
}
