//! Player Death & Tombstone Soul Recovery Subsystem.
//!
//! PORTS-PARTIAL: `run/death.ts` - NOT a finished port - 0 of 4 exported names carried over (0%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

pub const DEATH_GOLD_LOSS_PERCENT: f64 = 0.50;
pub const TOMBSTONE_CLAIM_RADIUS: f64 = 1.2;

#[derive(Debug, Clone, PartialEq)]
pub struct Tombstone {
    pub floor: u32,
    pub x: f64,
    pub z: f64,
    pub souls: u32,
    pub gold: u32,
    pub claimed: bool,
}

impl Tombstone {
    pub fn new(floor: u32, x: f64, z: f64, gold: u32, souls: u32) -> Self {
        Self {
            floor,
            x,
            z,
            souls,
            gold,
            claimed: false,
        }
    }
}

/// Processes player death, stamps a persistent tombstone with lost resources, and returns remaining wallet gold and souls.
pub fn handle_player_death(
    floor: u32,
    x: f64,
    z: f64,
    current_gold: u32,
    current_souls: u32,
) -> (Tombstone, u32, u32) {
    let lost_gold = (current_gold as f64 * DEATH_GOLD_LOSS_PERCENT).round() as u32;
    let retained_gold = current_gold - lost_gold;

    let lost_souls = current_souls;
    let retained_souls = 0;

    let tombstone = Tombstone::new(floor, x, z, lost_gold, lost_souls);

    (tombstone, retained_gold, retained_souls)
}

/// Checks if the player is within range of their tombstone to reclaim lost gold and souls.
pub fn claim_tombstone(
    tombstone: &mut Tombstone,
    player_x: f64,
    player_z: f64,
) -> Option<(u32, u32)> {
    if tombstone.claimed {
        return None;
    }

    let dx = tombstone.x - player_x;
    let dz = tombstone.z - player_z;
    if (dx * dx + dz * dz).sqrt() <= TOMBSTONE_CLAIM_RADIUS {
        tombstone.claimed = true;
        Some((tombstone.gold, tombstone.souls))
    } else {
        None
    }
}
