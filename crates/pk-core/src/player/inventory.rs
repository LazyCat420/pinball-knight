//! Player weapon inventory, 2-hand slot management, durability, and socketing.
//!
//! PORTS: `items.ts`, `economy/pickups.ts`

use crate::items::{WeaponDef, WeaponId};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WeaponInstance {
    pub id: WeaponId,
    pub durability: u32,
    pub max_durability: u32,
    pub sockets: [Option<String>; 3],
}

impl WeaponInstance {
    pub fn new(id: WeaponId) -> Self {
        let def = id.def();
        Self {
            id,
            durability: def.max_durability,
            max_durability: def.max_durability,
            sockets: [None, None, None],
        }
    }

    pub fn def(&self) -> WeaponDef {
        self.id.def()
    }

    pub fn is_broken(&self) -> bool {
        self.id != WeaponId::Fists && self.durability == 0
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlayerInventory {
    pub slots: [Option<WeaponInstance>; 2],
    pub active_slot: usize,
}

impl Default for PlayerInventory {
    fn default() -> Self {
        Self {
            slots: [Some(WeaponInstance::new(WeaponId::Sword)), None],
            active_slot: 0,
        }
    }
}

impl PlayerInventory {
    /// Creates a starter inventory with a starter Sword.
    pub fn starter() -> Self {
        Self::default()
    }

    /// Returns the currently active weapon instance, or Fists if empty/broken.
    pub fn active_weapon(&self) -> WeaponInstance {
        if let Some(w) = &self.slots[self.active_slot] {
            if !w.is_broken() {
                return w.clone();
            }
        }
        WeaponInstance::new(WeaponId::Fists)
    }

    /// Returns the inactive (back slot) weapon, if present.
    pub fn inactive_weapon(&self) -> Option<&WeaponInstance> {
        let other_slot = (self.active_slot + 1) % 2;
        self.slots[other_slot].as_ref()
    }

    /// Swaps hands between active and back slot weapons.
    pub fn swap_active_slot(&mut self) {
        self.active_slot = (self.active_slot + 1) % 2;
    }

    /// Sets active slot to 0 (primary) or 1 (secondary).
    pub fn select_slot(&mut self, slot: usize) {
        if slot < 2 {
            self.active_slot = slot;
        }
    }

    /// Equips a new weapon into the active slot, returning any dropped weapon.
    pub fn equip_weapon(&mut self, new_weapon: WeaponInstance) -> Option<WeaponInstance> {
        let old = self.slots[self.active_slot].take();
        self.slots[self.active_slot] = Some(new_weapon);
        old
    }

    /// Decrements durability on the active weapon after a swing.
    ///
    /// If durability reaches 0, the weapon breaks and reverts to Fists.
    pub fn decrement_active_durability(&mut self) -> bool {
        if let Some(w) = &mut self.slots[self.active_slot] {
            if w.id != WeaponId::Fists && w.durability > 0 {
                w.durability -= 1;
                if w.durability == 0 {
                    // Broken weapon
                    return true;
                }
            }
        }
        false
    }
}
