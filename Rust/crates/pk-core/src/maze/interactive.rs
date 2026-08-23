//! PORTS-NOTHING — auxiliary interactive helper; canonical decorate port is in pk-core/src/maze/decorate.rs

use crate::grid::{set_tile, Grid, T_CRACKED, T_FLOOR};

pub const SECRET_WALL_BREAK_SPEED: f64 = 7.5;
pub const PICKUP_RADIUS: f64 = 0.65;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GroundItemKind {
    Weapon(String),
    Potion(i32),
    Coins(i32),
    Card(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct GroundItem {
    pub id: u64,
    pub x: f64,
    pub z: f64,
    pub kind: GroundItemKind,
    pub collected: bool,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct InteractiveMazeState {
    pub items: Vec<GroundItem>,
    pub next_item_id: u64,
}

impl InteractiveMazeState {
    /// Spawns a new ground pickup item at world coordinates (x, z).
    pub fn spawn_item(&mut self, x: f64, z: f64, kind: GroundItemKind) -> u64 {
        let id = self.next_item_id;
        self.next_item_id += 1;
        self.items.push(GroundItem {
            id,
            x,
            z,
            kind,
            collected: false,
        });
        id
    }

    /// Checks and breaks a cracked secret wall if impact speed meets the threshold.
    ///
    /// Converts `T_CRACKED` into `T_FLOOR` and returns true if a wall was broken.
    pub fn try_break_cracked_wall(grid: &mut Grid, i: i32, j: i32, speed: f64) -> bool {
        if i < 0 || j < 0 || i >= grid.w || j >= grid.h {
            return false;
        }
        let idx = (j as usize) * (grid.w as usize) + (i as usize);
        if grid.t[idx] == T_CRACKED && speed >= SECRET_WALL_BREAK_SPEED {
            set_tile(grid, i, j, T_FLOOR);
            true
        } else {
            false
        }
    }

    /// Resolves walk-over pickups for the player.
    /// Returns a list of collected items this frame.
    pub fn step_pickups(&mut self, px: f64, pz: f64) -> Vec<GroundItemKind> {
        let mut collected = Vec::new();
        for item in &mut self.items {
            if !item.collected {
                let dx = px - item.x;
                let dz = pz - item.z;
                if (dx * dx + dz * dz) <= (PICKUP_RADIUS * PICKUP_RADIUS) {
                    item.collected = true;
                    collected.push(item.kind.clone());
                }
            }
        }
        self.items.retain(|it| !it.collected);
        collected
    }
}
