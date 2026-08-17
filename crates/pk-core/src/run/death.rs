//! Dying — corpse pile drops, inventory kit collection, and tavern recovery.
//!
//! PORTS: `run/death.ts`

use std::collections::HashMap;
use std::f64::consts::TAU;

use crate::grid::{is_walkable, tile_center, world_to_tile, Grid};
use crate::maze::nearest_open_tile::nearest_open_tile;
use crate::run::corpse_run::{add_pile, local_knight_id, piles_on_floor, CorpseItem, CorpsePile};

/// Represents a weapon in an active or reserve slot.
#[derive(Debug, Clone, PartialEq)]
pub struct WeaponSlotItem {
    pub id: String,
    pub durability: Option<f64>,
    pub rarity: Option<String>,
    pub cards: Vec<String>,
    pub upgrade: Option<u32>,
}

/// Computes fan-out world coordinates for items in a corpse pile around a tile center.
///
/// Index 0 sits dead centre (r = 0.0); remaining items fan out on a small ring (r = 0.34).
pub fn compute_corpse_item_fanout(centre_x: f64, centre_z: f64, count: usize) -> Vec<(f64, f64)> {
    let mut positions = Vec::with_capacity(count);
    let total = count.max(1) as f64;
    for n in 0..count {
        let r = if n == 0 { 0.0 } else { 0.34 };
        let ang = (n as f64 / total) * TAU;
        let x = centre_x + ang.cos() * r;
        let z = centre_z + ang.sin() * r;
        positions.push((x, z));
    }
    positions
}

/// Resolved position and metadata for a spawned corpse pile ground item.
#[derive(Debug, Clone, PartialEq)]
pub struct SpawnedCorpseItem {
    pub kind: String,
    pub id: String,
    pub x: f64,
    pub z: f64,
    pub durability: Option<f64>,
    pub rarity: Option<String>,
    pub cards: Vec<String>,
    pub upgrade: Option<u32>,
    pub corpse_owner: String,
    pub corpse_id: String,
}

/// Computes ground item spawns for all corpse piles stored on the given level.
///
/// If the saved death position falls inside a wall (e.g. maze shape rerolled),
/// searches outward with `nearest_open_tile` to guarantee the loot is reachable.
pub fn compute_corpse_pile_spawns(
    piles: &[CorpsePile],
    grid: &Grid,
    level: u32,
) -> Vec<SpawnedCorpseItem> {
    let mut spawned = Vec::new();
    for pile in piles_on_floor(piles, level) {
        let (mut ti, mut tj) = world_to_tile(grid, pile.x, pile.z);
        if !is_walkable(grid, ti, tj) {
            if let Some((oi, oj)) = nearest_open_tile(ti, tj, 1, 1, |i, j| is_walkable(grid, i, j)) {
                ti = oi;
                tj = oj;
            } else {
                continue;
            }
        }
        let (centre_x, centre_z) = tile_center(grid, ti, tj);
        let coords = compute_corpse_item_fanout(centre_x, centre_z, pile.items.len());
        for (item, (x, z)) in pile.items.iter().zip(coords.into_iter()) {
            spawned.push(SpawnedCorpseItem {
                kind: item.kind.clone(),
                id: item.id.clone(),
                x,
                z,
                durability: item.durability,
                rarity: item.rarity.clone(),
                cards: item.cards.clone(),
                upgrade: item.upgrade,
                corpse_owner: pile.owner.clone(),
                corpse_id: pile.id.clone(),
            });
        }
    }
    spawned
}

/// Serializes all carried weapons, equipped gear, and stashed cards into corpse items.
///
/// Fists are omitted; starting weapons and non-empty gear are preserved with full durability/rarity.
pub fn collect_corpse_items(
    weapon_slots: &[Option<WeaponSlotItem>],
    gear: &HashMap<String, f64>,
    card_stash: &[String],
) -> Vec<CorpseItem> {
    let mut items = Vec::new();
    for w in weapon_slots.iter().flatten() {
        if w.id == "fists" {
            continue;
        }
        items.push(CorpseItem {
            kind: "weapon".to_string(),
            id: w.id.clone(),
            durability: w.durability,
            rarity: w.rarity.clone(),
            cards: w.cards.clone(),
            upgrade: w.upgrade,
        });
    }
    for (slot, &dur) in gear {
        if dur <= 0.0 {
            continue;
        }
        items.push(CorpseItem {
            kind: "gear".to_string(),
            id: slot.clone(),
            durability: Some(dur),
            rarity: None,
            cards: Vec::new(),
            upgrade: None,
        });
    }
    for id in card_stash {
        items.push(CorpseItem {
            kind: "card".to_string(),
            id: id.clone(),
            durability: None,
            rarity: None,
            cards: Vec::new(),
            upgrade: None,
        });
    }
    items
}

/// Result of executing player death logic.
#[derive(Debug, Clone, PartialEq)]
pub struct DeathEventResult {
    pub death_floor: u32,
    pub dropped_items: Vec<CorpseItem>,
    pub new_pile: CorpsePile,
    pub resume_floor: u32,
}

/// Handles player death by converting carried items into a persistent corpse pile stamped at (player_x, player_z).
pub fn on_player_death(
    piles: &mut Vec<CorpsePile>,
    level: u32,
    player_x: f64,
    player_z: f64,
    weapon_slots: &[Option<WeaponSlotItem>],
    gear: &HashMap<String, f64>,
    card_stash: &[String],
    owner_id: Option<&str>,
) -> DeathEventResult {
    let dropped = collect_corpse_items(weapon_slots, gear, card_stash);
    let owner = owner_id.unwrap_or_else(|| local_knight_id());
    let new_pile = add_pile(piles, level, player_x, player_z, owner, dropped.clone());
    let resume_floor = level;

    DeathEventResult {
        death_floor: level,
        dropped_items: dropped,
        new_pile,
        resume_floor,
    }
}
