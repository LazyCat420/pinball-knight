//! Persistent Legacy Perks Store — Permanent account perks bought with wallet gold that survive death.
//!
//! PORTS: `legacy.ts`

use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LegacyPerkDef {
    pub id: &'static str,
    pub label: &'static str,
    pub icon: &'static str,
    pub description: &'static str,
    pub cost: u32,
    pub max_rank: u32,
    pub start_card: bool,
}

pub const LEGACY_PERKS: &[LegacyPerkDef] = &[
    LegacyPerkDef {
        id: "oldscar",
        label: "Old Scar",
        icon: "❤️",
        cost: 400,
        max_rank: 1,
        description: "+1 max heart, forever",
        start_card: false,
    },
    LegacyPerkDef {
        id: "veteran",
        label: "Veteran's Eye",
        icon: "📜",
        cost: 250,
        max_rank: 2,
        description: "+10% XP per rank, forever",
        start_card: false,
    },
    LegacyPerkDef {
        id: "luckycoin",
        label: "Lucky Coin",
        icon: "🪙",
        cost: 300,
        max_rank: 2,
        description: "coins worth +5% per rank, forever",
        start_card: false,
    },
    LegacyPerkDef {
        id: "heirloomedge",
        label: "Heirloom Edge",
        icon: "⚔️",
        cost: 500,
        max_rank: 1,
        description: "+5% damage, forever",
        start_card: false,
    },
    LegacyPerkDef {
        id: "packrat",
        label: "Pack Rat",
        icon: "🃏",
        cost: 350,
        max_rank: 1,
        description: "start every run with a random common card",
        start_card: true,
    },
];

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct LegacyStore {
    pub ranks: HashMap<String, u32>,
}

impl LegacyStore {
    pub fn new() -> Self {
        Self {
            ranks: HashMap::new(),
        }
    }

    /// Gets current rank of a legacy perk.
    pub fn perk_rank(&self, id: &str) -> u32 {
        self.ranks.get(id).copied().unwrap_or(0)
    }

    /// Increments bought rank up to authored max_rank. Returns new rank.
    pub fn add_perk_rank(&mut self, id: &str) -> u32 {
        if let Some(def) = LEGACY_PERKS.iter().find(|p| p.id == id) {
            let current = self.perk_rank(id);
            let next = (current + 1).min(def.max_rank);
            self.ranks.insert(id.to_string(), next);
            next
        } else {
            0
        }
    }

    /// Checks if the player owns the Pack Rat starting card perk.
    pub fn has_start_card_perk(&self) -> bool {
        self.perk_rank("packrat") > 0
    }
}
