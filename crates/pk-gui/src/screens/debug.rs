//! THE ` DEBUG PANEL, in the game.
//!
//! Port of `legacy/src/game/pinball-knight/gui/screens/debug.ts` (717 lines).
//!
//! Session-only god-mode tooling docked to the left edge of the arena so the
//! game world remains visible while manipulating live cheats, spawning monsters,
//! cycling ability/skill ranks, and adjusting sound.
//!
//! PORTS: `gui/screens/debug.ts`

use crate::im::{
    begin_scroll, button, end_scroll, fill_rect, heading, rect, stroke_rect, tabs, ButtonOpts,
    Rect, UiFrame,
};
use crate::theme::Ui;

pub const DESIGN_W: f64 = 560.0;
pub const DESIGN_H: f64 = 340.0;
pub const DESIGN_MAX: u32 = 2;

pub const CHIP_CHARS: usize = 8;
pub const ROW_CHARS: usize = 22;
pub const BIND_CHARS: usize = 17;
pub const HEAD_CHARS: usize = 26;

pub mod section {
    pub const CHEATS: &str = "CHEATS";
    pub const WEAPONS: &str = "WEAPONS";
    pub const MATERIALS: &str = "MATERIALS";
    pub const MONSTERS: &str = "MONSTERS";
    pub const POTIONS: &str = "POTIONS";
    pub const ABILITIES: &str = "ABILITIES";
    pub const SKILLS: &str = "SKILLS";
    pub const SOUND: &str = "SOUND";
}

pub mod skill_acts {
    pub const MAX: &str = "MAX ALL";
    pub const CLEAR: &str = "CLEAR";
}

pub mod sound_acts {
    pub const WAKE: &str = "UNMUTE THE APP";
    pub const MUTE: &str = "MUTE SFX";
    pub const UNMUTE: &str = "UNMUTE SFX";
}

pub fn bed_label(id: &str) -> &'static str {
    match id {
        "fire" => "FIRE BED",
        "water" => "WATERBED",
        _ => "BED",
    }
}

pub fn sfx_chip_label(name: &str) -> String {
    name.to_uppercase()
}

pub fn sound_heading(muted: bool, volume: f64) -> String {
    let vol_pct = (volume * 100.0).round() as i32;
    if muted {
        format!("SOUND: MUTED ({vol_pct}%)")
    } else {
        format!("SOUND: {vol_pct}%")
    }
}

pub fn monster_chip_label(kind: &str) -> String {
    kind.to_uppercase()
}

pub fn potion_chip_label(id: &str) -> String {
    id.to_uppercase()
}

pub fn skill_chip_label(id: &str, rank: u32) -> String {
    if rank == 0 {
        id.to_uppercase()
    } else {
        format!("{} [{}]", id.to_uppercase(), rank)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct DebugInspectorState {
    pub fps: f32,
    pub frame_time_ms: f32,
    pub monster_count: usize,
    pub floor_fx_count: usize,
    pub player_pos: (f64, f64),
    pub player_speed: f64,
    pub god_mode: bool,
    pub noclip: bool,
    pub active_section: usize,
    pub scroll_offset: f64,
}

impl Default for DebugInspectorState {
    fn default() -> Self {
        Self {
            fps: 60.0,
            frame_time_ms: 16.6,
            monster_count: 0,
            floor_fx_count: 0,
            player_pos: (0.0, 0.0),
            player_speed: 0.0,
            god_mode: false,
            noclip: false,
            active_section: 0,
            scroll_offset: 0.0,
        }
    }
}

pub trait ConsoleActions {
    fn toggle_god_mode(&mut self);
    fn toggle_noclip(&mut self);
    fn spawn_monster(&mut self, kind: &str);
    fn give_potion(&mut self, id: &str);
    fn set_ability_rank(&mut self, id: &str, rank: u32);
    fn max_all_skills(&mut self);
    fn clear_all_skills(&mut self);
}

/// Paints the live debug console docked on the left.
pub fn paint_debug_console(
    f: &mut UiFrame,
    state: &mut DebugInspectorState,
    actions: &mut dyn ConsoleActions,
) {
    let panel_rect = rect(8.0, 8.0, DESIGN_W, DESIGN_H);
    fill_rect(f, &panel_rect, Ui::SCRIM);
    stroke_rect(f, &panel_rect, Ui::GOLD, 1.0);

    heading(
        f,
        &rect(16.0, 16.0, DESIGN_W - 32.0, 20.0),
        "DEBUG CONSOLE",
        Ui::HEADING,
    );

    let tab_labels = [
        section::CHEATS,
        section::MONSTERS,
        section::POTIONS,
        section::ABILITIES,
        section::SKILLS,
        section::SOUND,
    ];

    let new_tab = tabs(
        f,
        &rect(16.0, 40.0, DESIGN_W - 32.0, 24.0),
        &tab_labels,
        state.active_section as i64,
    );
    state.active_section = new_tab as usize;

    let content_rect = rect(16.0, 70.0, DESIGN_W - 32.0, DESIGN_H - 86.0);
    let scroll = begin_scroll(f, &content_rect, 400.0, state.scroll_offset);
    state.scroll_offset = scroll.offset;

    let btn_rect = rect(scroll.inner.x + 8.0, scroll.inner.y + 8.0, 140.0, 26.0);
    if button(f, &btn_rect, "TOGGLE GOD MODE", ButtonOpts::default()) {
        actions.toggle_god_mode();
        state.god_mode = !state.god_mode;
    }

    let noclip_btn = rect(scroll.inner.x + 160.0, scroll.inner.y + 8.0, 140.0, 26.0);
    if button(f, &noclip_btn, "TOGGLE NOCLIP", ButtonOpts::default()) {
        actions.toggle_noclip();
        state.noclip = !state.noclip;
    }

    end_scroll(f, &content_rect, 400.0, state.scroll_offset);
}

/// Paints the live debug telemetry and entity inspector HUD overlay.
pub fn paint_debug(f: &mut UiFrame, _state: &DebugInspectorState, bounds: Rect) {
    let panel_rect = rect(bounds.x + 8.0, bounds.y + 8.0, 240.0, 180.0);

    fill_rect(f, &panel_rect, Ui::SCRIM);
    stroke_rect(f, &panel_rect, Ui::GOLD, 1.0);

    heading(
        f,
        &rect(panel_rect.x + 8.0, panel_rect.y + 6.0, 224.0, 16.0),
        "DEBUG TELEMETRY",
        Ui::HEADING,
    );
}
