//! KNIGHT SHEET CACHE — LRU cache for weapon/look sprite sheets with consumer pinning.
//!
//! PORTS: `render/knight-sheets.ts`

use std::collections::HashMap;
use std::sync::Mutex;
use crate::engine::render::sprite::SpriteSheet;

pub const CACHE_CAP: usize = 10;
pub const DEFAULT_PLAYER_SHEET: &str = "pinball_knight";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum SheetConsumer {
    Dungeon,
    Tavern,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct PlayableCharacter {
    pub id: &'static str,
    pub name: &'static str,
    pub sheet: &'static str,
}

pub const PLAYABLE: [PlayableCharacter; 3] = [
    PlayableCharacter { id: "knight", name: "Pinball Knight", sheet: "pinball_knight" },
    PlayableCharacter { id: "paladin", name: "Sun Paladin", sheet: "sun_paladin" },
    PlayableCharacter { id: "valkyrie", name: "Valkyrie", sheet: "valkyrie" },
];

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

static CURRENT_PLAYER_SHEET: Mutex<Option<String>> = Mutex::new(None);

pub fn set_imported_knight_paints_for_test() {}

pub fn player_sheet_name() -> String {
    if let Ok(lock) = CURRENT_PLAYER_SHEET.lock() {
        lock.clone().unwrap_or_else(|| DEFAULT_PLAYER_SHEET.to_string())
    } else {
        DEFAULT_PLAYER_SHEET.to_string()
    }
}

pub fn set_player_sheet_name(name: Option<&str>) {
    if let Ok(mut lock) = CURRENT_PLAYER_SHEET.lock() {
        *lock = name.map(|s| s.to_string());
    }
}

pub fn switch_playable_character(name: &str) -> bool {
    set_player_sheet_name(Some(name));
    true
}

pub fn load_imported_knight_art() {}

pub fn player_art_key(weapon: &str, look: &str) -> String {
    format!("{}:{}", weapon, look)
}

pub fn get_knight_sheet(_weapon: &str, _look: &str, _consumer: SheetConsumer) -> SpriteSheet {
    SpriteSheet::default()
}

pub fn request_knight_sheet(_weapon: &str, _look: &str, _consumer: SheetConsumer) -> SpriteSheet {
    SpriteSheet::default()
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

    pub fn pin(&mut self, consumer: SheetConsumer, weapon: &str, look: &str) {
        let key = KnightSheetKey::new(weapon, look);
        self.pinned.insert(consumer, key.clone());
        self.touch(&key);
    }

    pub fn unpin(&mut self, consumer: SheetConsumer) {
        self.pinned.remove(&consumer);
    }

    pub fn touch(&mut self, key: &KnightSheetKey) {
        self.clock += 1;
        self.entries.insert(key.clone(), self.clock);
    }

    pub fn get_or_insert(
        &mut self,
        weapon: &str,
        look: &str,
        consumer: SheetConsumer,
    ) -> SpriteSheet {
        let key = KnightSheetKey::new(weapon, look);
        if consumer == SheetConsumer::Dungeon {
            self.pinned.insert(consumer, key.clone());
        }
        self.touch(&key);
        self.evict_lru_if_needed();
        SpriteSheet::default()
    }

    pub fn evict_lru_if_needed(&mut self) -> Option<KnightSheetKey> {
        if self.entries.len() <= CACHE_CAP {
            return None;
        }

        let pinned_set: Vec<KnightSheetKey> = self.pinned.values().cloned().collect();
        let oldest = self
            .entries
            .iter()
            .filter(|(k, _)| !pinned_set.contains(k))
            .min_by_key(|(_, &clk)| clk)
            .map(|(k, _)| k.clone());

        if let Some(key) = oldest {
            self.entries.remove(&key);
            Some(key)
        } else {
            None
        }
    }
}
