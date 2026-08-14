// Parity test for Card Socketing, Weapon Stat Modifiers, and Stash Overflow.
// Replicates legacy/src/game/pinball-knight/cards.ts, economy/pickups.ts

use pk_core::items::WeaponId;
use pk_core::player::inventory::PlayerInventory;

#[test]
fn card_auto_sockets_into_active_weapon_first() {
    let mut inv = PlayerInventory::starter();
    let sword_base_dmg = inv.active_damage();

    // Socket card 1 into active sword
    let socketed = inv.socket_or_stash_card("spidersilk#1");
    assert!(socketed, "Card 1 should socket into active weapon");
    assert_eq!(inv.active_damage(), sword_base_dmg + 1);

    // Socket card 2 into active sword
    let socketed2 = inv.socket_or_stash_card("hulk_rage#1");
    assert!(socketed2, "Card 2 should socket into active weapon");
    assert_eq!(inv.active_damage(), sword_base_dmg + 2);
}

#[test]
fn cards_overflow_to_stash_when_all_sockets_are_full() {
    let mut inv = PlayerInventory::starter();

    // Fill all 3 sockets on active sword
    assert!(inv.socket_or_stash_card("card_1"));
    assert!(inv.socket_or_stash_card("card_2"));
    assert!(inv.socket_or_stash_card("card_3"));

    // Slot 2 is empty, so 4th card goes to stash
    let socketed4 = inv.socket_or_stash_card("card_4");
    assert!(!socketed4, "4th card should go to card stash");
    assert_eq!(inv.card_stash.len(), 1);
    assert_eq!(inv.card_stash[0], "card_4");
}
