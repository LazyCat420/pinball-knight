//! DEV / QA WINDOW HOOKS — Scriptable harness interface for headless and automated testing.
//!
//! Provides spawning, inventory injection, floor descend commands, and simulation state telemetry.
//!
//! PORTS-PARTIAL: `dev/window-hooks.ts` - NOT a finished port - 56 rust code lines against 631 legacy (9%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

#[derive(Clone, Debug, PartialEq)]
pub struct DungeonStats {
    pub player_hp: i32,
    pub player_mana: i32,
    pub floor_depth: u32,
    pub active_zombies: usize,
    pub explored_ratio: f64,
}

impl Default for DungeonStats {
    fn default() -> Self {
        Self {
            player_hp: 100,
            player_mana: 100,
            floor_depth: 1,
            active_zombies: 0,
            explored_ratio: 0.0,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct DungeonWindowHooks {
    pub stats: DungeonStats,
    pub spawned_entities: Vec<(String, f64, f64)>,
    pub inventory: Vec<String>,
    pub speed_override: Option<f64>,
}

impl DungeonWindowHooks {
    pub fn new() -> Self {
        Self::default()
    }

    /// Spawns an enemy by kind at specified (x, z) world coordinates.
    pub fn dungeon_spawn(&mut self, kind: &str, x: f64, z: f64) {
        self.spawned_entities.push((kind.to_string(), x, z));
        self.stats.active_zombies += 1;
    }

    /// Injects a weapon into the player inventory.
    pub fn dungeon_give_weapon(&mut self, weapon_id: &str) {
        self.inventory.push(weapon_id.to_string());
    }

    /// Injects a potion into the player inventory.
    pub fn dungeon_give_potion(&mut self, potion_id: &str) {
        self.inventory.push(potion_id.to_string());
    }

    /// Immediately triggers a descent to the next floor depth.
    pub fn dungeon_descend(&mut self) {
        self.stats.floor_depth += 1;
    }

    /// Overrides player/pinball movement max speed.
    pub fn dungeon_set_speed(&mut self, speed: f64) {
        self.speed_override = Some(speed);
    }

    /// Returns a snapshot of real-time dungeon telemetry.
    pub fn dungeon_stats(&self) -> DungeonStats {
        self.stats.clone()
    }
}
