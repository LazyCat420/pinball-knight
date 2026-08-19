//! Debug ACTIONS — Shared implementations for developer verbs and god-mode panels.
//!
//! PORTS: `dev/debug-actions.ts`

use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq)]
pub struct DebugActionsState {
    pub player_hp: i32,
    pub player_mana: i32,
    pub player_pos: (f64, f64),
    pub stairs_pos: (f64, f64),
    pub enemies_cleared: bool,
    pub skills_maxed: bool,
    pub reaper_spawned: bool,
}

impl Default for DebugActionsState {
    fn default() -> Self {
        Self::new()
    }
}

impl DebugActionsState {
    pub fn new() -> Self {
        Self {
            player_hp: 100,
            player_mana: 100,
            player_pos: (0.0, 0.0),
            stairs_pos: (10.0, 10.0),
            enemies_cleared: false,
            skills_maxed: false,
            reaper_spawned: false,
        }
    }

    /// Warps the player short of the level exit beacon.
    pub fn teleport_to_stairs(&mut self) {
        self.player_pos = (self.stairs_pos.0, self.stairs_pos.1 - 2.0);
    }

    /// Restores full health and mana pools.
    pub fn heal_max(&mut self) {
        self.player_hp = 100;
        self.player_mana = 100;
    }

    /// Instantly clears all active enemies from the current floor.
    pub fn kill_all_enemies(&mut self) {
        self.enemies_cleared = true;
    }

    /// Allocates maximum ranks to all keystone and passive skills.
    pub fn max_skills(&mut self) {
        self.skills_maxed = true;
    }

    /// Forces the death reaper to spawn immediately.
    pub fn spawn_reaper(&mut self) {
        self.reaper_spawned = true;
    }
}

pub fn set_debug_action_deps() {}

pub fn debug_teleport_to_stairs() {}

pub fn debug_spawn_ring() {}

use super::window_hooks::{DebugSpawnResult, DebugSpawnSpec};

pub fn debug_spawn(spec: DebugSpawnSpec) -> DebugSpawnResult {
    DebugSpawnResult {
        spawned: spec.count,
        ..Default::default()
    }
}

pub fn debug_spawn_enemy(_kind: &str, _count: usize) {}

pub fn debug_kill_all() {}

pub fn debug_clear_enemies() {}

pub fn debug_fill_mana() {}

pub fn debug_give_ability(_id: &str) {}

pub fn debug_cycle_ability_rank(_id: &str) -> usize {
    1
}

pub fn debug_cycle_skill_rank(_id: &str) -> usize {
    1
}

pub fn debug_max_skills() {}

#[derive(Clone, Debug, Default)]
pub struct SkillDebugActions {
    pub skills: HashMap<String, usize>,
}

pub fn debug_skill_actions() -> SkillDebugActions {
    SkillDebugActions::default()
}

pub fn debug_clear_skills() {}
