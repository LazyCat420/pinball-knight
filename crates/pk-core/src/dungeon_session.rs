//! DUNGEON SESSION LIFECYCLE — High-level dungeon lifecycle orchestrator and two-slot weapon inventory.
//!
//! Port of `legacy/src/game/pinball-knight/core.ts` (594 lines).
//!
//! Handles:
//! - Game loop lifecycle, active session status, and entrance/exit triggers
//! - Two-slot weapon inventory with hot-swapping and in-place floor weapon exchange
//! - Run progression, floor depth tracking, score calculation, and floor grading
//! - Reaper timeout countdown and session metrics accumulation
//!
//! PORTS: `core.ts`

use std::sync::atomic::{AtomicBool, Ordering};

static DUNGEON_ACTIVE: AtomicBool = AtomicBool::new(false);

pub fn is_dungeon_game_active() -> bool {
    DUNGEON_ACTIVE.load(Ordering::Relaxed)
}

pub fn launch_dungeon_game() {
    DUNGEON_ACTIVE.store(true, Ordering::Relaxed);
}

pub fn exit_dungeon_game() {
    DUNGEON_ACTIVE.store(false, Ordering::Relaxed);
}

#[derive(Clone, Debug, PartialEq)]
pub struct DungeonSessionState {
    pub floor_depth: u32,
    pub world_seed: u32,
    pub is_active: bool,
    pub weapon_slots: [Option<String>; 2],
    pub active_slot: usize,
    pub elapsed_time: f64,
    pub floor_time: f64,
    pub score: u64,
    pub gold_collected: u32,
    pub enemies_slain: u32,
    pub reaper_timer: f64,
    pub reaper_spawned: bool,
    pub is_paused: bool,
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
            elapsed_time: 0.0,
            floor_time: 0.0,
            score: 0,
            gold_collected: 0,
            enemies_slain: 0,
            reaper_timer: 120.0, // 2 minutes before reaper arrives
            reaper_spawned: false,
            is_paused: false,
        }
    }

    /// Initializes a new active dungeon run for the given world seed.
    pub fn enter_dungeon(&mut self, seed: u32) {
        self.floor_depth = 1;
        self.world_seed = seed;
        self.is_active = true;
        self.active_slot = 0;
        self.weapon_slots = [Some("sword_basic".to_string()), None];
        self.elapsed_time = 0.0;
        self.floor_time = 0.0;
        self.score = 0;
        self.gold_collected = 0;
        self.enemies_slain = 0;
        self.reaper_timer = 120.0;
        self.reaper_spawned = false;
        self.is_paused = false;
        launch_dungeon_game();
    }

    /// Exits the current dungeon session.
    pub fn exit_dungeon(&mut self) {
        self.is_active = false;
        exit_dungeon_game();
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
            let old_weapon = self.weapon_slots[self.active_slot].take();
            self.weapon_slots[self.active_slot] = Some(weapon_id.to_string());
            old_weapon
        }
    }

    /// Advances simulation timers and checks for reaper arrival.
    pub fn advance_time(&mut self, dt: f64) {
        if !self.is_active || self.is_paused {
            return;
        }

        self.elapsed_time += dt;
        self.floor_time += dt;
        self.reaper_timer = (self.reaper_timer - dt).max(0.0);

        if self.reaper_timer <= 0.0 && !self.reaper_spawned {
            self.reaper_spawned = true;
        }
    }

    /// Records an enemy kill and awards score and gold.
    pub fn record_kill(&mut self, gold_reward: u32, score_reward: u64) {
        self.enemies_slain += 1;
        self.gold_collected += gold_reward;
        self.score += score_reward;
    }

    /// Progresses the dungeon run down to the next floor depth.
    pub fn descend_next_floor(&mut self) {
        self.floor_depth += 1;
        self.floor_time = 0.0;
        self.reaper_timer = (120.0 - (self.floor_depth as f64 * 3.0)).max(45.0);
        self.reaper_spawned = false;
        self.score += 500 * self.floor_depth as u64;
    }
}
