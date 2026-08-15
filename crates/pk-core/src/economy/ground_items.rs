//! Ground-Item Substrate — Unified removal funnel, drop network id sequence, and corpse pile lifecycle.
//!
//! PORTS: `economy/ground-items.ts`

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GroundItemRecord {
    pub id: u32,
    pub nid: Option<String>,
    pub corpse_id: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct GroundItemRegistry {
    pub items: Vec<GroundItemRecord>,
    pub item_nid_seq: u32,
}

impl GroundItemRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Next runtime drop id. Bumped per mid-floor authority roll (e.g. "d0", "d1").
    pub fn next_item_nid(&mut self) -> String {
        let nid = format!("d{}", self.item_nid_seq);
        self.item_nid_seq += 1;
        nid
    }

    /// Zeroes the runtime drop sequence counter per floor.
    pub fn reset_item_nid(&mut self) {
        self.item_nid_seq = 0;
    }

    /// Adds a ground item to the registry.
    pub fn add_item(&mut self, item: GroundItemRecord) {
        self.items.push(item);
    }

    /// Pulls a ground item out of the registry and returns it.
    pub fn remove_ground_item(&mut self, index: usize) -> Option<GroundItemRecord> {
        if index < self.items.len() {
            Some(self.items.remove(index))
        } else {
            None
        }
    }

    /// Returns true if all ground items associated with a corpse pile have been removed.
    pub fn is_corpse_pile_cleared(&self, corpse_id: u32) -> bool {
        !self.items.iter().any(|it| it.corpse_id == Some(corpse_id))
    }
}
