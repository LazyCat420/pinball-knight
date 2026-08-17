//! PORTS-PARTIAL: `state.ts` - NOT a finished port - no measurable port behind the claim. Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

use crate::cards::{card_def, cards_of_rarity, CardRarity};
use crate::rng::Mulberry32;

#[derive(Debug, Clone, PartialEq)]
pub struct DraftChoice {
    pub card_id: &'static str,
    pub label: String,
    pub level: i32,
    pub rarity: CardRarity,
    pub is_shiny: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DraftOffer {
    pub choices: [DraftChoice; 3],
}

/// Generates a 3-card draft pick based on current dungeon floor level and seeded PRNG.
pub fn generate_draft_offer(floor_level: u32, prng: &mut Mulberry32) -> DraftOffer {
    let rarity_roll = prng.next_f64();
    let rarity = if rarity_roll < 0.10 && floor_level >= 3 {
        CardRarity::Legendary
    } else if rarity_roll < 0.35 && floor_level >= 2 {
        CardRarity::Epic
    } else if rarity_roll < 0.70 {
        CardRarity::Rare
    } else {
        CardRarity::Common
    };

    let pool = cards_of_rarity(rarity);
    let pool_len = pool.len().max(1);

    let mut picked = [0usize; 3];
    picked[0] = (prng.next_f64() * pool_len as f64) as usize % pool_len;
    picked[1] = (picked[0] + 1) % pool_len;
    picked[2] = (picked[0] + 2) % pool_len;

    let build_choice = |idx: usize, prng: &mut Mulberry32| {
        let card_id = pool[idx];
        let def = card_def(card_id);
        let label = def
            .as_ref()
            .map(|c| c.label().to_string())
            .unwrap_or_else(|| card_id.to_string());
        DraftChoice {
            card_id,
            label,
            level: (floor_level as i32 / 2).max(1),
            rarity,
            is_shiny: prng.next_f64() < 0.05,
        }
    };

    let c0 = build_choice(picked[0], prng);
    let c1 = build_choice(picked[1], prng);
    let c2 = build_choice(picked[2], prng);

    DraftOffer {
        choices: [c0, c1, c2],
    }
}
