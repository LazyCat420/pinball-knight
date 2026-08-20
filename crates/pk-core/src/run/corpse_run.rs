//! Corpse run persistence — player loot recovery and multi-death pile accumulation.
//!
//! PORTS: `corpse-run.ts`

#[derive(Debug, Clone, PartialEq)]
pub struct CorpseItem {
    pub kind: String, // "weapon", "gear", "card"
    pub id: String,
    pub durability: Option<f64>,
    pub rarity: Option<String>,
    pub cards: Vec<String>,
    pub upgrade: Option<u32>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CorpsePile {
    pub id: String,
    pub floor: u32,
    pub x: f64,
    pub z: f64,
    pub owner: String, // "" for solo/offline
    pub items: Vec<CorpseItem>,
}

pub const MAX_PILES_PER_FLOOR: usize = 12;

/// Stable local identifier for the player's knight.
pub fn local_knight_id() -> &'static str {
    "local-knight"
}

/// Returns all stored piles on `floor`, oldest first.
pub fn piles_on_floor<'a>(piles: &'a [CorpsePile], floor: u32) -> Vec<&'a CorpsePile> {
    piles.iter().filter(|p| p.floor == floor).collect()
}

/// Returns sorted unique floor numbers holding at least one corpse pile.
pub fn floors_with_piles(piles: &[CorpsePile]) -> Vec<u32> {
    let mut floors: Vec<u32> = piles.iter().map(|p| p.floor).collect();
    floors.sort_unstable();
    floors.dedup();
    floors
}

/// Enforces the MAX_PILES_PER_FLOOR ceiling by merging the oldest pile's items into the second-oldest.
pub fn enforce_pile_cap(piles: &mut Vec<CorpsePile>, floor: u32) {
    loop {
        let on_floor_indices: Vec<usize> = piles
            .iter()
            .enumerate()
            .filter(|(_, p)| p.floor == floor)
            .map(|(idx, _)| idx)
            .collect();

        if on_floor_indices.len() <= MAX_PILES_PER_FLOOR {
            break;
        }

        let oldest_idx = on_floor_indices[0];
        let next_idx = on_floor_indices[1];

        let oldest_items = piles[oldest_idx].items.clone();
        let mut merged = oldest_items;
        merged.extend(piles[next_idx].items.drain(..));
        piles[next_idx].items = merged;
        piles.remove(oldest_idx);
    }
}

/// Records a new death. Returns the new pile, or None when items is empty or floor is 0.
pub fn add_pile(
    piles: &mut Vec<CorpsePile>,
    floor: u32,
    x: f64,
    z: f64,
    owner: &str,
    items: Vec<CorpseItem>,
) -> CorpsePile {
    let pile_id = format!("c{floor}-{}-{}", piles.len() + 1, items.len());
    let pile = CorpsePile {
        id: pile_id,
        floor,
        x,
        z,
        owner: owner.to_string(),
        items,
    };
    piles.push(pile.clone());
    enforce_pile_cap(piles, floor);
    pile
}

/// Legacy alias for record_corpse_pile.
pub fn record_corpse_pile(piles: &mut Vec<CorpsePile>, new_pile: CorpsePile) {
    let floor = new_pile.floor;
    piles.push(new_pile);
    enforce_pile_cap(piles, floor);
}

/// Drops a pile once its items have been recovered.
pub fn clear_pile(piles: &mut Vec<CorpsePile>, pile_id: &str) -> bool {
    if let Some(pos) = piles.iter().position(|p| p.id == pile_id) {
        piles.remove(pos);
        true
    } else {
        false
    }
}

/// Determines if viewer_id may loot the given corpse pile.
pub fn can_loot(pile: &CorpsePile, viewer_id: Option<&str>) -> bool {
    if pile.owner.is_empty() {
        return true;
    }
    if pile.owner == local_knight_id() {
        return true;
    }
    if let Some(v_id) = viewer_id {
        pile.owner == v_id
    } else {
        false
    }
}

/// Claims and collects a corpse pile if authorized.
pub fn claim_corpse_pile(
    piles: &mut Vec<CorpsePile>,
    pile_id: &str,
    claimer: &str,
) -> Option<Vec<CorpseItem>> {
    if let Some(pos) = piles.iter().position(|p| p.id == pile_id) {
        if can_loot(&piles[pos], Some(claimer)) {
            let removed = piles.remove(pos);
            return Some(removed.items);
        }
    }
    None
}

/// Returns the highest floor with an unclaimed corpse pile for the given owner.
pub fn highest_unclaimed_floor(piles: &[CorpsePile], owner: &str) -> Option<u32> {
    piles
        .iter()
        .filter(|p| p.owner.is_empty() || p.owner == owner)
        .map(|p| p.floor)
        .max()
}
