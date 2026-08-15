//! Dungeon Run Telemetry Ledger — Run lifetime statistics, character progression resets, and leaderboard payload tracking.
//!
//! PORTS: `run/ledger.ts`

#[derive(Clone, Debug, PartialEq)]
pub struct RunLedgerState {
    pub deepest_floor: u32,
    pub best_combo: u32,
    pub start_time_ms: f64,
    pub paused_s: f64,
    pub score_submitted: bool,
    pub char_level: u32,
    pub char_xp: u32,
    pub skill_points: u32,
    pub unlocked_abilities: Vec<String>,
    pub card_stash: Vec<String>,
    pub flasks: u32,
}

/// Begins a new run ledger and resets roguelite run character progression.
pub fn begin_run_ledger(start_time_ms: f64, has_pack_rat_perk: bool) -> RunLedgerState {
    let mut card_stash = Vec::new();
    if has_pack_rat_perk {
        // Starter perk seeds common card
        card_stash.push("card_iron_nail_common".to_string());
    }

    RunLedgerState {
        deepest_floor: 1,
        best_combo: 0,
        start_time_ms,
        paused_s: 0.0,
        score_submitted: false,
        char_level: 1,
        char_xp: 0,
        skill_points: 0,
        unlocked_abilities: vec!["flippercharge".to_string(), "arcanepulse".to_string()],
        card_stash,
        flasks: 0,
    }
}

/// Updates the deepest floor reached during this run.
pub fn record_floor_reached(ledger: &mut RunLedgerState, floor: u32) {
    if floor > ledger.deepest_floor {
        ledger.deepest_floor = floor;
    }
}

/// Updates the best combo streak achieved during this run.
pub fn record_combo(ledger: &mut RunLedgerState, combo: u32) {
    if combo > ledger.best_combo {
        ledger.best_combo = combo;
    }
}
