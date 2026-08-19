//! DUNGEON SESSION LIFECYCLE — High-level dungeon lifecycle orchestrator and two-slot weapon inventory.
//!
//! Manages dungeon enter/exit states, fixed 60Hz step coordination, and weapon inventory swapping and in-place exchange.
//!
//! PORTS: `core.ts`

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

static IS_ACTIVE: AtomicBool = AtomicBool::new(false);
static SESSION: Mutex<Option<DungeonSessionState>> = Mutex::new(None);

pub fn is_dungeon_game_active() -> bool {
    IS_ACTIVE.load(Ordering::Relaxed)
}

pub fn launch_dungeon_game() {
    IS_ACTIVE.store(true, Ordering::Relaxed);
    if let Ok(mut lock) = SESSION.lock() {
        let mut state = DungeonSessionState::new();
        state.enter_dungeon(12345);
        *lock = Some(state);
    }
}

pub fn exit_dungeon_game() {
    IS_ACTIVE.store(false, Ordering::Relaxed);
    if let Ok(mut lock) = SESSION.lock() {
        *lock = None;
    }
}

pub fn start_level(depth: u32, seed: u32) {
    if let Ok(mut lock) = SESSION.lock() {
        if let Some(state) = lock.as_mut() {
            state.floor_depth = depth;
            state.world_seed = seed;
        } else {
            let mut state = DungeonSessionState::new();
            state.enter_dungeon(seed);
            state.floor_depth = depth;
            *lock = Some(state);
        }
    }
}

pub fn load_dungeon_floor(depth: u32) {
    start_level(depth, 1000 + depth * 17);
}

pub fn reset_dungeon_run() {
    exit_dungeon_game();
    launch_dungeon_game();
}

pub fn advance_floor() -> u32 {
    if let Ok(mut lock) = SESSION.lock() {
        if let Some(state) = lock.as_mut() {
            state.floor_depth += 1;
            state.world_seed += 1;
            state.floor_depth
        } else {
            1
        }
    } else {
        1
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct DungeonSessionState {
    pub floor_depth: u32,
    pub world_seed: u32,
    pub is_active: bool,
    pub weapon_slots: [Option<String>; 2],
    pub active_slot: usize,
    pub kills: u32,
    pub gold: u32,
    pub combo: u32,
    pub damage_dealt: u64,
    pub damage_taken: u64,
}

impl Default for DungeonSessionState {
    fn default() -> Self {
        Self::new()
    }
}

impl DungeonSessionState {
    pub fn new() -> Self {
        Self {
            floor_depth: 1,
            world_seed: 0,
            is_active: false,
            weapon_slots: [Some("sword_basic".to_string()), None],
            active_slot: 0,
            kills: 0,
            gold: 0,
            combo: 0,
            damage_dealt: 0,
            damage_taken: 0,
        }
    }

    /// Initializes a new active dungeon run for the given world seed.
    pub fn enter_dungeon(&mut self, seed: u32) {
        self.floor_depth = 1;
        self.world_seed = seed;
        self.is_active = true;
        self.active_slot = 0;
        self.weapon_slots = [Some("sword_basic".to_string()), None];
        self.kills = 0;
        self.gold = 0;
        self.combo = 0;
        self.damage_dealt = 0;
        self.damage_taken = 0;
    }

    /// Exits the current dungeon run.
    pub fn exit_dungeon(&mut self) {
        self.is_active = false;
    }

    /// Swaps the active weapon between slot 0 and slot 1.
    pub fn swap_weapon(&mut self) {
        let other_slot = 1 - self.active_slot;
        if self.weapon_slots[other_slot].is_some() {
            self.active_slot = other_slot;
        }
    }

    /// Returns the currently active weapon ID if present.
    pub fn active_weapon(&self) -> Option<&String> {
        self.weapon_slots[self.active_slot].as_ref()
    }

    /// Equips a weapon. If both hands are full, exchanges with the active hand and returns the dropped weapon.
    pub fn equip_weapon(&mut self, weapon_id: &str) -> Option<String> {
        let empty_idx = self.weapon_slots.iter().position(|s| s.is_none());
        if let Some(idx) = empty_idx {
            self.weapon_slots[idx] = Some(weapon_id.to_string());
            self.active_slot = idx;
            None
        } else {
            let dropped = self.weapon_slots[self.active_slot].take();
            self.weapon_slots[self.active_slot] = Some(weapon_id.to_string());
            dropped
        }
    }

    pub fn record_kill(&mut self) {
        self.kills += 1;
        self.combo += 1;
    }

    pub fn add_gold(&mut self, amount: u32) {
        self.gold += amount;
    }

    pub fn reset_combo(&mut self) {
        self.combo = 0;
    }

    pub fn record_combat_stats(&mut self, dealt: u64, taken: u64) {
        self.damage_dealt += dealt;
        self.damage_taken += taken;
    }
}
