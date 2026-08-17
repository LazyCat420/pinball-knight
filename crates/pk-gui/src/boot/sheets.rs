//! SPRITE ATLASES & WEAPON ART LOADER — Dynamic player composite key atlas manager.
//!
//! Rebuilds player sheets when composite weapon, worn gear look, or character choices change.
//!
//! PORTS-PARTIAL: `boot/sheets.ts` - NOT a finished port - 27 rust code lines against 234 legacy (12%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

pub const DIRS: [&str; 3] = ["S", "N", "E"];
pub const WEAPON_ART_SLICE_MS: f64 = 2.0;

/// Derives the unique composite player art key from weapon, gear look, and character ID.
pub fn player_art_key(weapon_id: &str, look: &str, character_id: &str) -> String {
    format!("{}:{}:{}", character_id, weapon_id, look)
}

/// Resolves sprite sheet path for a given weapon and gear look.
pub fn player_sheet_for(weapon_id: &str, look: &str) -> String {
    format!("sprites/knight_{}_{}.png", weapon_id, look)
}

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
