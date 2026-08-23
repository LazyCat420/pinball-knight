// Parity test suite for Sprite Sheets Boot Loader.
// Replicates legacy/src/game/pinball-knight/boot/sheets.ts

use pk_gui::boot::sheets::{apply_weapon_art, player_art_key, player_sheet_for};

#[test]
fn sheets_boot_composite_keys_and_swaps() {
    let key = player_art_key("sword_iron", "plate_gold", "knight_mario");
    assert_eq!(key, "knight_mario:sword_iron:plate_gold");

    let path = player_sheet_for("sword_iron", "plate_gold");
    assert_eq!(path, "sprites/knight_sword_iron_plate_gold.png");

    let mut current_key = String::new();
    let changed1 = apply_weapon_art("sword_iron", "plate_gold", "knight_mario", &mut current_key);
    assert!(changed1);
    assert_eq!(current_key, "knight_mario:sword_iron:plate_gold");

    // Redundant apply should return false
    let changed2 = apply_weapon_art("sword_iron", "plate_gold", "knight_mario", &mut current_key);
    assert!(!changed2);
}
