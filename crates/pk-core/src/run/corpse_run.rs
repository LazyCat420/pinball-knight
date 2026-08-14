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

pub const MAX_PILES_PER_FLOOR: usize = 3;

/// Records a new corpse pile on a floor.
///
/// If the floor already has MAX_PILES_PER_FLOOR for this owner, the oldest pile's
/// items are merged into the second-oldest pile to prevent data loss while respecting the cap.
pub fn record_corpse_pile(piles: &mut Vec<CorpsePile>, new_pile: CorpsePile) {
    let floor_piles_indices: Vec<usize> = piles
        .iter()
        .enumerate()
        .filter(|(_, p)| p.floor == new_pile.floor && (p.owner == new_pile.owner || p.owner.is_empty()))
        .map(|(idx, _)| idx)
        .collect();

    if floor_piles_indices.len() >= MAX_PILES_PER_FLOOR {
        let oldest_idx = floor_piles_indices[0];
        let second_oldest_idx = floor_piles_indices[1];

        // Drain items from oldest and merge into second oldest
        let oldest_items = piles[oldest_idx].items.clone();
        piles[second_oldest_idx].items.extend(oldest_items);

        // Remove oldest pile
        piles.remove(oldest_idx);
    }

    piles.push(new_pile);
}

/// Claims and collects a corpse pile if the claimer is authorized.
pub fn claim_corpse_pile(
    piles: &mut Vec<CorpsePile>,
    pile_id: &str,
    claimer: &str,
) -> Option<Vec<CorpseItem>> {
    if let Some(pos) = piles.iter().position(|p| p.id == pile_id) {
        let pile = &piles[pos];
        if pile.owner.is_empty() || pile.owner == claimer {
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
