//! DUNGEON SESSION LIFECYCLE — High-level dungeon lifecycle orchestrator and two-slot weapon inventory.
//!
//! Manages dungeon enter/exit states, fixed 60Hz step coordination, and weapon inventory swapping and in-place exchange.
//!
//! PORTS: `core.ts`

#[derive(Clone, Debug, PartialEq)]
pub struct DungeonSessionState {
    pub floor_depth: u32,
    pub world_seed: u32,
    pub is_active: bool,
    pub weapon_slots: [Option<String>; 2],
    pub active_slot: usize,
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
        }
    }

    /// Initializes a new active dungeon run for the given world seed.
    pub fn enter_dungeon(&mut self, seed: u32) {
        self.floor_depth = 1;
        self.world_seed = seed;
        self.is_active = true;
        self.active_slot = 0;
        self.weapon_slots = [Some("sword_basic".to_string()), None];
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
        // If empty slot exists, fill it
        let empty_idx = self.weapon_slots.iter().position(|s| s.is_none());
        if let Some(idx) = empty_idx {
            self.weapon_slots[idx] = Some(weapon_id.to_string());
            self.active_slot = idx;
            None
        } else {
            // Hands full: exchange with active hand
            let old = self.weapon_slots[self.active_slot].replace(weapon_id.to_string());
            old
        }
    }

    /// Cleans up session state on dungeon exit.
    pub fn exit_dungeon(&mut self) {
        self.is_active = false;
    }
}
