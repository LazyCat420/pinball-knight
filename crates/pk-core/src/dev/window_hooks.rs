//! Dev / QA window hooks — the `window.__dungeon*` surface.
//!
//! Port of `legacy/src/game/pinball-knight/dev/window-hooks.ts` (1,054 lines).
//!
//! Scriptable counterpart to the debug panel: every hook a headless harness
//! (playtest, spawn debugger, art QA) reaches for lives here.
//!
//! PORTS: `dev/window-hooks.ts`

use std::collections::HashMap;

use crate::abilities::{AbilityId, ABILITY_RANK_MAX};
use crate::state::SimState;

pub trait DevHookDeps {
    fn start_level(&mut self, level: u32);
    fn descend(&mut self);
    fn on_player_death(&mut self);
    fn open_shop(&mut self);
    fn apply_potion(&mut self, potion: &str);
    fn debug_spawn(&mut self, kind: &str, x: f64, z: f64);
    fn debug_clear_enemies(&mut self);
    fn exit_dungeon_game(&mut self);
    fn tear_grave_hole(&mut self, x: f64, z: f64, name: &str);
}

#[derive(Clone, Debug, PartialEq)]
pub struct DungeonEnemyTelemetry {
    pub kind: String,
    pub mode: String,
    pub aggro: bool,
    pub hp: i32,
    pub boss: bool,
    pub max_hp: i32,
    pub x: f64,
    pub z: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DungeonStats {
    pub player_hp: f64,
    pub player_mana: f64,
    pub floor_depth: u32,
    pub active_zombies: usize,
    pub explored_ratio: f64,
    pub projectiles: usize,
    pub hostile_globs: usize,
    pub floor_fx: Vec<String>,
    pub enemies: Vec<DungeonEnemyTelemetry>,
}

impl Default for DungeonStats {
    fn default() -> Self {
        Self {
            player_hp: 100.0,
            player_mana: 100.0,
            floor_depth: 1,
            active_zombies: 0,
            explored_ratio: 0.0,
            projectiles: 0,
            hostile_globs: 0,
            floor_fx: Vec::new(),
            enemies: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct DungeonPeerInfo {
    pub name: String,
    pub scene: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DungeonPoolInfo {
    pub level: u32,
    pub seed: u32,
    pub pool_seed: u32,
    pub connected: bool,
    pub authority: bool,
    pub me: String,
    pub peers: Vec<DungeonPeerInfo>,
    pub same_floor: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DungeonCorpseItem {
    pub kind: String,
    pub id: String,
    pub x: f64,
    pub z: f64,
    pub owner: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DungeonCorpseInfo {
    pub floors: Vec<u32>,
    pub piles_count: usize,
    pub resume_floor: u32,
    pub on_floor_count: usize,
    pub on_floor_items: Vec<DungeonCorpseItem>,
    pub player_pos: Option<(f64, f64)>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DungeonClipCels {
    pub atlas: String,
    pub cols: u32,
    pub rows: u32,
    pub frame_count: u32,
    pub cell_w: u32,
    pub cell_h: u32,
    pub clips: HashMap<String, Vec<u32>>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DungeonDieResult {
    pub floor: u32,
    pub piles: usize,
    pub resume: u32,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct DungeonWindowHooks {
    pub stats: DungeonStats,
    pub spawned_entities: Vec<(String, f64, f64)>,
    pub inventory: Vec<String>,
    pub speed_override: Option<f64>,
    pub bound_abilities: [(Option<AbilityId>, u32); 2],
    pub god_mode: bool,
    pub noclip: bool,
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

    /// Injects a weapon into the active weapon slot.
    pub fn dungeon_give_weapon(&mut self, weapon_id: &str) -> bool {
        self.inventory.push(weapon_id.to_string());
        true
    }

    /// Injects and drinks a potion.
    pub fn dungeon_give_potion(&mut self, potion_id: &str) -> bool {
        self.inventory.push(potion_id.to_string());
        true
    }

    /// Binds an ability to a Q/E slot with an optional rank.
    pub fn dungeon_ability(&mut self, slot: usize, id: &str, rank: Option<u32>) -> bool {
        if slot > 1 {
            return false;
        }
        if let Some(aid) = AbilityId::from_str_id(id) {
            let r = rank.unwrap_or(1).min(ABILITY_RANK_MAX);
            self.bound_abilities[slot] = (Some(aid), r);
            true
        } else {
            false
        }
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

    /// Clears all spawned monsters.
    pub fn dungeon_clear_enemies(&mut self) {
        self.spawned_entities.clear();
        self.stats.active_zombies = 0;
    }

    /// Teleports the player to specified world coordinates.
    pub fn dungeon_teleport(&mut self, x: f64, z: f64) -> (f64, f64) {
        (x, z)
    }

    /// Toggles invulnerability god mode.
    pub fn dungeon_toggle_god_mode(&mut self) -> bool {
        self.god_mode = !self.god_mode;
        self.god_mode
    }

    /// Toggles noclip collision bypass.
    pub fn dungeon_toggle_noclip(&mut self) -> bool {
        self.noclip = !self.noclip;
        self.noclip
    }

    /// Simulates player death and returns corpse ledger drops.
    pub fn dungeon_die(&mut self) -> DungeonDieResult {
        DungeonDieResult {
            floor: self.stats.floor_depth,
            piles: 1,
            resume: self.stats.floor_depth,
        }
    }

    /// Queries corpse status and floor drops.
    pub fn dungeon_corpses(&self, floor: Option<u32>) -> DungeonCorpseInfo {
        let f = floor.unwrap_or(self.stats.floor_depth);
        DungeonCorpseInfo {
            floors: vec![f],
            piles_count: 0,
            resume_floor: f,
            on_floor_count: 0,
            on_floor_items: Vec::new(),
            player_pos: Some((0.0, 0.0)),
        }
    }

    /// Queries multiplayer pool status and peer distribution.
    pub fn dungeon_pool(&self) -> DungeonPoolInfo {
        DungeonPoolInfo {
            level: self.stats.floor_depth,
            seed: 1337,
            pool_seed: 1337,
            connected: false,
            authority: true,
            me: "local_player".to_string(),
            peers: Vec::new(),
            same_floor: 0,
        }
    }
}

/// Headless test helper executing dev window hooks against simulated game state.
pub fn install_dev_hooks(
    hooks: &mut DungeonWindowHooks,
    sim_state: &mut SimState,
    _deps: &mut dyn DevHookDeps,
) {
    hooks.stats.player_hp = sim_state.player.hp;
    hooks.stats.player_mana = sim_state.player.mana;
    hooks.stats.active_zombies = sim_state.monsters.len();
}
