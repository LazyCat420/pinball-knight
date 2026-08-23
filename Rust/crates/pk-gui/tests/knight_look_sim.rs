// Parity test suite for Knight Equipment Appearance Model.
// Replicates legacy/src/game/pinball-knight/render/knight-look.ts

use pk_gui::render::knight_look::{look_from_gear, look_key, FULL_PLATE};

#[test]
fn full_plate_defaults_to_all_pieces_equipped() {
    assert!(FULL_PLATE.helmet);
    assert!(FULL_PLATE.armor);
    assert!(FULL_PLATE.boots);
    assert_eq!(FULL_PLATE.style, None);
}

#[test]
fn look_from_gear_evaluates_positive_durability() {
    let look = look_from_gear(10, 0, 1, Some("crypt_steel"));
    assert!(look.helmet);
    assert!(!look.armor);
    assert!(look.boots);
    assert_eq!(look.style.as_deref(), Some("crypt_steel"));
}

#[test]
fn look_key_formats_composite_cache_key() {
    let look = look_from_gear(10, 0, 1, Some("ice"));
    assert_eq!(look_key("sword", &look), "sword|101|ice");

    let default_look = look_from_gear(5, 5, 0, None);
    assert_eq!(look_key("hammer", &default_look), "hammer|110|iron");
}
