//! KNIGHT SHEET CACHE — LRU cache for weapon/look sprite sheets with consumer pinning.
//!
//! PORTS-PARTIAL: `render/knight-sheets.ts` - NOT a finished port - 2 of 10 exported names carried over (20%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

use std::collections::HashMap;

pub const CACHE_CAP: usize = 10;
pub const DEFAULT_PLAYER_SHEET: &str = "pinball_knight";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum SheetConsumer {
    Dungeon,
    Tavern,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct KnightSheetKey {
    pub weapon: String,
    pub look: String,
}

impl KnightSheetKey {
    pub fn new(weapon: &str, look: &str) -> Self {
        Self {
            weapon: weapon.to_string(),
            look: look.to_string(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct KnightSheetCache {
    pub entries: HashMap<KnightSheetKey, u64>,
    pub pinned: HashMap<SheetConsumer, KnightSheetKey>,
    pub clock: u64,
    pub current_sheet_name: String,
}

impl Default for KnightSheetCache {
    fn default() -> Self {
        Self::new()
    }
}

impl KnightSheetCache {
    pub fn new() -> Self {
        Self {
            entries: HashMap::new(),
            pinned: HashMap::new(),
            clock: 0,
            current_sheet_name: DEFAULT_PLAYER_SHEET.to_string(),
        }
    }

    pub fn is_cached(&self, weapon: &str, look: &str) -> bool {
        let key = KnightSheetKey::new(weapon, look);
        self.entries.contains_key(&key)
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Fetches or registers a sheet for a consumer, pinning it and evicting unpinned LRU entries if capacity is exceeded.
    pub fn get_or_insert(&mut self, weapon: &str, look: &str, consumer: SheetConsumer) {
        self.clock += 1;
        let key = KnightSheetKey::new(weapon, look);

        // Update entry timestamp
        self.entries.insert(key.clone(), self.clock);
        // Update pinned consumer
        self.pinned.insert(consumer, key);

        // If over capacity, evict oldest unpinned entry
        if self.entries.len() > CACHE_CAP {
            let pinned_keys: Vec<KnightSheetKey> = self.pinned.values().cloned().collect();

            let mut candidates: Vec<(&KnightSheetKey, &u64)> = self
                .entries
                .iter()
                .filter(|(k, _)| !pinned_keys.contains(k))
                .collect();

            candidates.sort_by_key(|(_, &ts)| ts);

            if let Some((oldest_key, _)) = candidates.first() {
                let to_remove = (*oldest_key).clone();
                self.entries.remove(&to_remove);
            }
        }
    }

    pub fn switch_player_sheet(&mut self, name: &str) {
        self.current_sheet_name = name.to_string();
        self.entries.clear();
        self.pinned.clear();
    }
}
