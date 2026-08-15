// Parity test suite for UI Entry Points Shim.
// Replicates legacy/src/game/pinball-knight/ui.ts

use pk_gui::ui_shim::{
    create_floating_combo, create_pickup_note, create_toast_announcement, ShopEntry,
};

#[test]
fn shop_entry_structure_instantiation() {
    let entry = ShopEntry {
        id: "ware_potion".to_string(),
        label: "Health Potion".to_string(),
        icon: "flask".to_string(),
        price: 50,
        detail: "Restores 40 HP".to_string(),
    };
    assert_eq!(entry.id, "ware_potion");
    assert_eq!(entry.price, 50);
}

#[test]
fn ui_notification_event_constructors() {
    let banner = create_toast_announcement("Floor Cleared", "Rank: S");
    assert_eq!(banner.text, "Floor Cleared");
    assert_eq!(banner.subtext, "Rank: S");

    let pickup = create_pickup_note("Gold +100");
    assert_eq!(pickup.text, "Gold +100");
    assert_eq!(pickup.subtext, "");

    let combo = create_floating_combo(15, 300.0, 150.0);
    assert_eq!(combo.combo, 15);
    assert_eq!(combo.sx, 300.0);
    assert_eq!(combo.sy, 150.0);
}
