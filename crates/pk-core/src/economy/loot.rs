//! Monster corpse loot tables and dungeon chest reward generation.
//!
//! PORTS-PARTIAL: `economy/loot.ts` - NOT a finished port - 0 of 7 exported names carried over (0%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

use crate::items::WeaponId;
use crate::reagents::ReagentId;
use crate::rng::Mulberry32;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChestTier {
    Wood,
    Iron,
    Gold,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MonsterLootDrop {
    pub gold: i64,
    pub reagent: Option<ReagentId>,
    pub weapon: Option<WeaponId>,
    pub card_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ChestReward {
    pub gold: i64,
    pub potion: Option<String>,
    pub weapon: Option<WeaponId>,
    pub card_id: Option<String>,
}

/// Rolls loot dropped by a defeated monster corpse.
pub fn roll_monster_loot(
    kind_name: &str,
    floor: u32,
    is_boss: bool,
    rng: &mut Mulberry32,
) -> MonsterLootDrop {
    if is_boss {
        return MonsterLootDrop {
            gold: 150 + (rng.next_f64() * 100.0) as i64 + (floor as i64 * 25),
            reagent: Some(ReagentId::Grimbone),
            weapon: Some(WeaponId::Greatsword),
            card_id: Some("boss_king".to_string()),
        };
    }

    let (base_gold, max_bonus, reagent_id, reagent_chance) = match kind_name {
        "brute" => (8, 10, ReagentId::Hide, 0.45),
        "frog" => (3, 4, ReagentId::Venomsac, 0.35),
        "goblin" => (5, 6, ReagentId::Goblintooth, 0.40),
        "jester" => (6, 8, ReagentId::Ectoplasm, 0.40),
        "reaper" => (12, 16, ReagentId::Lodestone, 0.50),
        "slime" => (2, 4, ReagentId::Slimegel, 0.35),
        "spider" => (3, 5, ReagentId::Silk, 0.35),
        "stiltneck" => (7, 9, ReagentId::Steelpin, 0.45),
        _ => (2, 4, ReagentId::Rotflesh, 0.25),
    };

    let gold = base_gold + (rng.next_f64() * max_bonus as f64) as i64 + (floor as i64 * 2);

    let reagent = if rng.next_f64() < reagent_chance {
        Some(reagent_id)
    } else {
        None
    };

    let weapon = if rng.next_f64() < 0.08 {
        let weapons = [
            WeaponId::Sword,
            WeaponId::Stick,
            WeaponId::Mace,
            WeaponId::Bow,
            WeaponId::Gun,
        ];
        let idx = (rng.next_f64() * weapons.len() as f64) as usize % weapons.len();
        Some(weapons[idx])
    } else {
        None
    };

    let card_id = if rng.next_f64() < 0.15 {
        Some(format!("{}_card", kind_name))
    } else {
        None
    };

    MonsterLootDrop {
        gold,
        reagent,
        weapon,
        card_id,
    }
}

/// Rolls rewards when opening a dungeon chest.
pub fn roll_chest_loot(tier: ChestTier, floor: u32, rng: &mut Mulberry32) -> ChestReward {
    match tier {
        ChestTier::Wood => ChestReward {
            gold: 15 + (rng.next_f64() * 15.0) as i64 + (floor as i64 * 3),
            potion: if rng.next_f64() < 0.5 {
                Some("health_potion".to_string())
            } else {
                None
            },
            weapon: None,
            card_id: None,
        },
        ChestTier::Iron => ChestReward {
            gold: 40 + (rng.next_f64() * 30.0) as i64 + (floor as i64 * 8),
            potion: Some("mana_flask".to_string()),
            weapon: if rng.next_f64() < 0.4 {
                Some(WeaponId::Mace)
            } else {
                None
            },
            card_id: if rng.next_f64() < 0.3 {
                Some("iron_guard".to_string())
            } else {
                None
            },
        },
        ChestTier::Gold => ChestReward {
            gold: 120 + (rng.next_f64() * 80.0) as i64 + (floor as i64 * 20),
            potion: Some("elixir_strength".to_string()),
            weapon: Some(WeaponId::Warhammer),
            card_id: Some("golden_aegis".to_string()),
        },
    }
}
