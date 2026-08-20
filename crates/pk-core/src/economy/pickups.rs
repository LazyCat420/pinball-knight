//! High-speed line segment sweep pickup detection and floor item absorption.
//!
//! PORTS: `economy/pickups.ts`

use crate::items::WeaponId;
use crate::maze::interactive::{GroundItem, GroundItemKind};
use crate::player::inventory::{PlayerInventory, WeaponInstance};

pub const PICKUP_RANGE: f64 = 0.65;
pub const CARD_PICKUP_RANGE: f64 = 1.10;
pub const BOOTS_SPEED_FACTOR: f64 = 1.15;

/// Distance from point (px, pz) to the line SEGMENT (ax, az) -> (bx, bz).
///
/// This ensures high-velocity ball rolls (>15 u/s) never skip over pickups between ticks.
pub fn segment_distance(ax: f64, az: f64, bx: f64, bz: f64, px: f64, pz: f64) -> f64 {
    let dx = bx - ax;
    let dz = bz - az;
    let len_sq = dx * dx + dz * dz;

    if len_sq < 1e-12 {
        let ex = px - ax;
        let ez = pz - az;
        return (ex * ex + ez * ez).sqrt();
    }

    // Projection scalar clamped to [0, 1] segment
    let t = (((px - ax) * dx + (pz - az) * dz) / len_sq).clamp(0.0, 1.0);
    let proj_x = ax + t * dx;
    let proj_z = az + t * dz;

    let rx = px - proj_x;
    let rz = pz - proj_z;
    (rx * rx + rz * rz).sqrt()
}

/// Checks if a player's movement segment intersects an item's grab radius.
pub fn check_segment_pickup(
    prev_x: f64,
    prev_z: f64,
    curr_x: f64,
    curr_z: f64,
    item_x: f64,
    item_z: f64,
    grab_range: f64,
) -> bool {
    segment_distance(prev_x, prev_z, curr_x, curr_z, item_x, item_z) <= grab_range
}

/// Reset sweep cache when floor or level changes.
pub fn reset_pickup_sweep() {}

/// Picks up a card from the floor and adds it to stash or active weapon.
pub fn pick_up_card(inventory: &mut PlayerInventory, card_id: &str) -> bool {
    inventory.socket_or_stash_card(card_id)
}

/// Picks up a weapon dropped on the ground.
pub fn pick_up_weapon(inventory: &mut PlayerInventory, weapon_id_str: &str) -> bool {
    let weapon_id = match weapon_id_str {
        "fists" => WeaponId::Fists,
        "stick" => WeaponId::Stick,
        "mace" => WeaponId::Mace,
        "chair" => WeaponId::Chair,
        "greatsword" => WeaponId::Greatsword,
        "warhammer" => WeaponId::Warhammer,
        "wreckingball" => WeaponId::Wreckingball,
        "gun" => WeaponId::Gun,
        "bow" => WeaponId::Bow,
        "flamethrower" => WeaponId::Flamethrower,
        _ => WeaponId::Sword,
    };
    inventory.equip_weapon(WeaponInstance::new(weapon_id));
    true
}

/// Check all ground items for pickup along the player's movement line.
pub fn check_pickups(
    items: &mut Vec<GroundItem>,
    prev_x: f64,
    prev_z: f64,
    curr_x: f64,
    curr_z: f64,
    inventory: &mut PlayerInventory,
) -> Vec<GroundItem> {
    let mut collected = Vec::new();
    let mut i = 0;
    while i < items.len() {
        let it = &items[i];
        let range = match &it.kind {
            GroundItemKind::Card(_) => CARD_PICKUP_RANGE,
            _ => PICKUP_RANGE,
        };

        if check_segment_pickup(prev_x, prev_z, curr_x, curr_z, it.x, it.z, range) {
            let mut item = items.remove(i);
            item.collected = true;
            match &item.kind {
                GroundItemKind::Card(card_id) => {
                    pick_up_card(inventory, card_id);
                }
                GroundItemKind::Weapon(weapon_id) => {
                    pick_up_weapon(inventory, weapon_id);
                }
                _ => {}
            }
            collected.push(item);
        } else {
            i += 1;
        }
    }
    collected
}
