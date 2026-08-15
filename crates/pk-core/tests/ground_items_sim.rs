// Parity test suite for Ground-Item Substrate.
// Replicates legacy/src/game/pinball-knight/economy/ground-items.ts

use pk_core::economy::ground_items::{GroundItemRecord, GroundItemRegistry};

#[test]
fn item_nid_sequencing_and_reset() {
    let mut reg = GroundItemRegistry::new();
    assert_eq!(reg.next_item_nid(), "d0");
    assert_eq!(reg.next_item_nid(), "d1");
    assert_eq!(reg.next_item_nid(), "d2");

    reg.reset_item_nid();
    assert_eq!(reg.next_item_nid(), "d0");
}

#[test]
fn ground_item_removal_and_corpse_pile_lifecycle() {
    let mut reg = GroundItemRegistry::new();

    reg.add_item(GroundItemRecord {
        id: 1,
        nid: Some("d0".into()),
        corpse_id: Some(10),
    });
    reg.add_item(GroundItemRecord {
        id: 2,
        nid: Some("d1".into()),
        corpse_id: Some(10),
    });

    // Pile 10 is not cleared while 2 items remain
    assert!(!reg.is_corpse_pile_cleared(10));

    // Remove first item
    let removed1 = reg.remove_ground_item(0);
    assert_eq!(removed1.unwrap().id, 1);
    assert!(!reg.is_corpse_pile_cleared(10));

    // Remove second item
    let removed2 = reg.remove_ground_item(0);
    assert_eq!(removed2.unwrap().id, 2);

    // Now pile 10 is cleared
    assert!(reg.is_corpse_pile_cleared(10));
}
