//! Loot drops — what a corpse leaves behind.
//!
//! Port of `legacy/src/game/pinball-knight/economy/loot.ts` (164 lines).
//!
//! PORTS: `economy/loot.ts`

use crate::bestiary::family_affinity;
use crate::reagents::{drops_for_kind, ReagentId};
use crate::rng::Mulberry32;
use crate::state::{EnemyKind, GroundItem, HaulEntry, SimState};

/// Drop a carried weapon on the floor.
pub fn drop_weapon(sim: &mut SimState, weapon_id: &str, x: f64, z: f64) {
    sim.ground_items.push(GroundItem {
        id: weapon_id.to_string(),
        kind: "weapon".to_string(),
        x,
        z,
        tier: 0,
        life: 60.0,
    });
}

/// A kill rolled the dice — maybe spawn a modifier card on the floor.
pub fn drop_card_maybe(
    sim: &mut SimState,
    x: f64,
    z: f64,
    boss: bool,
    kind: EnemyKind,
    drop_mult: f64,
    rng: &mut Mulberry32,
) {
    let kills = sim.kills as usize;
    let _affinity = family_affinity(kills);
    let card_chance = if boss { 1.0 } else { 0.01 * drop_mult };

    if rng.next_f64() < card_chance {
        // Pick an affinity or generic card
        let card_id = match kind {
            EnemyKind::Spider => "spider_silk",
            EnemyKind::Zombie => "zombie_stride",
            EnemyKind::Ghost => "ghost_drift",
            EnemyKind::Bat => "bat_wing",
            EnemyKind::Brute => "brute_slam",
            _ => "iron_edge",
        };
        spawn_card_drop(sim, x, z, card_id);
    }
}

/// Put a SPECIFIC card on the floor.
pub fn spawn_card_drop(sim: &mut SimState, x: f64, z: f64, card_id: &str) {
    sim.ground_items.push(GroundItem {
        id: card_id.to_string(),
        kind: "card".to_string(),
        x,
        z,
        tier: 0,
        life: 60.0,
    });
}

/// Credit a reagent straight into the run pouch.
pub fn credit_reagent(sim: &mut SimState, id: ReagentId) {
    sim.haul.push(HaulEntry {
        id: id.as_str().to_string(),
        count: 1,
        kind: "reagent".to_string(),
        tier: 0,
    });
}

/// Spawn a reagent mote on the floor.
pub fn spawn_reagent_mote(sim: &mut SimState, x: f64, z: f64, id: ReagentId) {
    sim.ground_items.push(GroundItem {
        id: id.as_str().to_string(),
        kind: "reagent".to_string(),
        x,
        z,
        tier: 0,
        life: 60.0,
    });
}

/// Roll a kill's themed reagent drops and scatter them.
pub fn drop_reagents_maybe(
    sim: &mut SimState,
    x: f64,
    z: f64,
    kind: EnemyKind,
    boss: bool,
    drop_mult: f64,
    rng: &mut Mulberry32,
) {
    let drops = drops_for_kind(kind.as_str());
    for entry in drops {
        let chance = if boss { 1.0 } else { entry.chance * drop_mult };
        if rng.next_f64() < chance {
            spawn_reagent_mote(sim, x, z, entry.id);
        }
    }
}

/// Drop a marble material on the floor.
pub fn spawn_material_drop(sim: &mut SimState, x: f64, z: f64, material: &str) {
    sim.ground_items.push(GroundItem {
        id: material.to_string(),
        kind: "material".to_string(),
        x,
        z,
        tier: 0,
        life: 60.0,
    });
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChestTier {
    Wood,
    Iron,
    Gold,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MonsterLootDrop {
    pub gold: i64,
    pub reagent: Option<ReagentId>,
    pub weapon: Option<crate::items::WeaponId>,
    pub card_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ChestReward {
    pub gold: i64,
    pub potion: Option<String>,
    pub weapon: Option<crate::items::WeaponId>,
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
            weapon: Some(crate::items::WeaponId::Greatsword),
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

    MonsterLootDrop {
        gold,
        reagent,
        weapon: None,
        card_id: None,
    }
}

/// Rolls chest rewards based on tier and dungeon floor.
pub fn roll_chest_loot(tier: ChestTier, floor: u32, rng: &mut Mulberry32) -> ChestReward {
    match tier {
        ChestTier::Wood => ChestReward {
            gold: 20 + (rng.next_f64() * 15.0) as i64 + (floor as i64 * 5),
            potion: None,
            weapon: None,
            card_id: None,
        },
        ChestTier::Iron => ChestReward {
            gold: 60 + (rng.next_f64() * 40.0) as i64 + (floor as i64 * 10),
            potion: Some("health_potion".to_string()),
            weapon: Some(crate::items::WeaponId::Sword),
            card_id: None,
        },
        ChestTier::Gold => ChestReward {
            gold: 150 + (rng.next_f64() * 80.0) as i64 + (floor as i64 * 20),
            potion: Some("elixir_of_haste".to_string()),
            weapon: Some(crate::items::WeaponId::Greatsword),
            card_id: Some("gold_tier_power".to_string()),
        },
    }
}
