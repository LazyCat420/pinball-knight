//! SPRITE ATLASES & WEAPON ART LOADER — Dynamic player composite key atlas manager.
//!
//! Rebuilds player sheets when composite weapon, worn gear look, or character choices change.
//!
//! PORTS: `boot/sheets.ts`

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use crate::engine::render::sprite::SpriteSheet;

pub const DIRS: [&str; 3] = ["S", "N", "E"];
pub const WEAPON_ART_SLICE_MS: f64 = 2.0;

static IMPORTED_ART_ENABLED: AtomicBool = AtomicBool::new(true);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum SheetKey {
    Knight,
    Paladin,
    Valkyrie,
    Zombie,
    Skeleton,
    Slime,
    Ghost,
    Gargoyle,
    Necromancer,
    Dragon,
    Reaper,
}

pub fn sheet_key_by_kind_map() -> HashMap<&'static str, SheetKey> {
    let mut m = HashMap::new();
    m.insert("knight", SheetKey::Knight);
    m.insert("paladin", SheetKey::Paladin);
    m.insert("valkyrie", SheetKey::Valkyrie);
    m.insert("zombie", SheetKey::Zombie);
    m.insert("skeleton", SheetKey::Skeleton);
    m.insert("slime", SheetKey::Slime);
    m.insert("ghost", SheetKey::Ghost);
    m.insert("gargoyle", SheetKey::Gargoyle);
    m.insert("necromancer", SheetKey::Necromancer);
    m.insert("dragon", SheetKey::Dragon);
    m.insert("reaper", SheetKey::Reaper);
    m
}

pub fn imported_art_map() -> HashMap<SheetKey, &'static str> {
    let mut m = HashMap::new();
    m.insert(SheetKey::Knight, "sprites/pinball_knight.png");
    m.insert(SheetKey::Paladin, "sprites/sun_paladin.png");
    m.insert(SheetKey::Valkyrie, "sprites/valkyrie.png");
    m.insert(SheetKey::Zombie, "sprites/zombie.png");
    m.insert(SheetKey::Skeleton, "sprites/skeleton.png");
    m
}

/// Derives the unique composite player art key from weapon, gear look, and character ID.
pub fn player_art_key(weapon_id: &str, look: &str, character_id: &str) -> String {
    format!("{}:{}:{}", character_id, weapon_id, look)
}

/// Resolves sprite sheet for a given weapon and gear look.
pub fn player_sheet_for(weapon_id: &str, look: &str) -> String {
    format!("sprites/knight_{}_{}.png", weapon_id, look)
}

pub fn sheet_for(_key: SheetKey) -> SpriteSheet {
    SpriteSheet::default()
}

pub fn paints_for(_key: SheetKey) {}

pub fn build_monster_sheets() {}

pub fn imported_art_enabled() -> bool {
    IMPORTED_ART_ENABLED.load(Ordering::Relaxed)
}

pub fn apply_imported_art() {}

pub fn apply_imported_monster_art() {}

pub fn stop_sheet_backfill() {}

pub fn paint_menu_portrait() {}

/// Applies weapon and worn gear art to the player sprite. Returns true if art key changed.
pub fn apply_weapon_art(
    active_weapon: &str,
    active_look: &str,
    character_id: &str,
    current_key: &mut String,
) -> bool {
    let key = player_art_key(active_weapon, active_look, character_id);
    if *current_key == key {
        false
    } else {
        *current_key = key;
        true
    }
}
