//! Wall Erosion — masonry that takes partial damage and melts/sags.
//!
//! PORTS: `entities/wall-erosion.ts`

use std::collections::HashMap;

pub const WALL_EROSION_MELT_SAG: f64 = 0.45;
pub const WALL_EROSION_EMBERS: usize = 6;
pub const LAVA_MELT_PER_HIT: f64 = 0.35;
pub const LAVA_MELT_MIN_SPEED: f64 = 4.0;
pub const LAVA_MELT_SPEED_SCALE: f64 = 12.0;

#[derive(Debug, Clone, PartialEq, Default)]
pub struct WallErosionTracker {
    pub scars: HashMap<(i32, i32), f64>,
    pub floor_id: u32,
}

impl WallErosionTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Resets erosion scars lazily if the current floor has changed.
    pub fn check_floor(&mut self, current_floor: u32) {
        if self.floor_id != current_floor {
            self.scars.clear();
            self.floor_id = current_floor;
        }
    }

    /// Erodes a wall tile by a given amount. Returns `true` if erosion reached 1.0 (smashed).
    pub fn erode_tile(&mut self, i: i32, j: i32, amount: f64, current_floor: u32) -> bool {
        self.check_floor(current_floor);

        let entry = self.scars.entry((i, j)).or_insert(0.0);
        *entry = (*entry + amount).min(1.0);

        *entry >= 1.0
    }

    /// Calculates erosion from a lava marble impact scaled by impact velocity.
    pub fn erode_from_lava(
        &mut self,
        i: i32,
        j: i32,
        impact_speed: f64,
        current_floor: u32,
    ) -> bool {
        if impact_speed < LAVA_MELT_MIN_SPEED {
            return false;
        }

        let speed_factor = (impact_speed / LAVA_MELT_SPEED_SCALE).clamp(0.5, 2.0);
        let amount = LAVA_MELT_PER_HIT * speed_factor;

        self.erode_tile(i, j, amount, current_floor)
    }

    /// Returns the current erosion value [0.0..1.0] of a tile.
    pub fn get_erosion(&self, i: i32, j: i32) -> f64 {
        self.scars.get(&(i, j)).copied().unwrap_or(0.0)
    }

    /// Returns the vertical sag multiplier for instance scaling based on erosion.
    pub fn get_sag(&self, i: i32, j: i32) -> f64 {
        let erosion = self.get_erosion(i, j);
        1.0 - erosion * WALL_EROSION_MELT_SAG
    }
}

pub fn wall_erosion_at(tracker: &WallErosionTracker, i: i32, j: i32) -> f64 {
    tracker.get_erosion(i, j)
}

pub fn reset_wall_erosion(tracker: &mut WallErosionTracker) {
    tracker.scars.clear();
}

pub fn erode_wall_at(
    tracker: &mut WallErosionTracker,
    i: i32,
    j: i32,
    amount: f64,
    current_floor: u32,
) -> &'static str {
    if tracker.erode_tile(i, j, amount, current_floor) {
        "broken"
    } else {
        "eroded"
    }
}

pub fn lava_melt_wall(
    tracker: &mut WallErosionTracker,
    i: i32,
    j: i32,
    impact_speed: f64,
    current_floor: u32,
) {
    tracker.erode_from_lava(i, j, impact_speed, current_floor);
}
