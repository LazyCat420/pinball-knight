// Parity test for Player Weapon Inventory, Slot Swapping, and Durability Decay.
// Replicates legacy/src/game/pinball-knight/items.ts, economy/pickups.ts

use pk_core::items::WeaponId;
use pk_core::player::inventory::{PlayerInventory, WeaponInstance};

#[test]
fn starter_inventory_has_sword_in_primary_slot() {
    let inv = PlayerInventory::starter();
    assert_eq!(inv.active_slot, 0);
    assert_eq!(inv.active_weapon().id, WeaponId::Sword);
    assert_eq!(inv.active_weapon().durability, 30);
    assert_eq!(inv.inactive_weapon(), None);
}

#[test]
fn swapping_hands_switches_between_weapons() {
    let mut inv = PlayerInventory::starter();
    // Equip a Mace in secondary slot
    inv.slots[1] = Some(WeaponInstance::new(WeaponId::Mace));

    assert_eq!(inv.active_weapon().id, WeaponId::Sword);

    inv.swap_active_slot();
    assert_eq!(inv.active_slot, 1);
    assert_eq!(inv.active_weapon().id, WeaponId::Mace);

    inv.swap_active_slot();
    assert_eq!(inv.active_slot, 0);
    assert_eq!(inv.active_weapon().id, WeaponId::Sword);
}

#[test]
fn empty_slot_falls_back_to_fists() {
    let mut inv = PlayerInventory::starter();
    inv.swap_active_slot();
    assert_eq!(inv.active_slot, 1);
    assert_eq!(inv.slots[1], None);
    assert_eq!(inv.active_weapon().id, WeaponId::Fists);
}

#[test]
fn equipping_weapon_replaces_active_slot_and_returns_old() {
    let mut inv = PlayerInventory::starter();
    let warhammer = WeaponInstance::new(WeaponId::Warhammer);

    let old_weapon = inv.equip_weapon(warhammer);
    assert_eq!(old_weapon.unwrap().id, WeaponId::Sword);
    assert_eq!(inv.active_weapon().id, WeaponId::Warhammer);
}

#[test]
fn weapon_durability_breaks_to_fists_at_zero() {
    let mut inv = PlayerInventory::starter();
    // Set low durability
    if let Some(w) = &mut inv.slots[0] {
        w.durability = 1;
    }

    let broken = inv.decrement_active_durability();
    assert!(broken, "Weapon should report breaking at 0 durability");
    assert_eq!(inv.active_weapon().id, WeaponId::Fists, "Broken weapon falls back to Fists");
}
