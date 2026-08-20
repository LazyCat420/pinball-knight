//! Debug Telemetry & Engine Inspector Screen.
//!
//! PORTS: `gui/screens/debug.ts`

use crate::im::{fill_rect, stroke_rect, text, Align, Rect, TextOpts, UiFrame};
use crate::theme::Ui;
use std::collections::HashMap;

pub const DESIGN_W: usize = 560;
pub const DESIGN_H: usize = 340;
pub const DESIGN_MAX: usize = 2;

pub const CHIP_CHARS: usize = 8;
pub const ROW_CHARS: usize = 22;
pub const BIND_CHARS: usize = 17;
pub const HEAD_CHARS: usize = 26;

pub const SECTION_HERO: &str = "HERO & CHEATS";
pub const SECTION_SOUND: &str = "SOUND & AMBIENCE";
pub const SECTION_MONSTERS: &str = "SPAWN MONSTERS";
pub const SECTION_ITEMS: &str = "ITEMS & POTIONS";

pub fn sfx_chip_label(name: &str) -> String {
    name.to_uppercase()
}

pub fn sound_heading() -> &'static str {
    "SFX / MUSIC CONTROL"
}

pub fn bed_label_map() -> HashMap<&'static str, &'static str> {
    let mut m = HashMap::new();
    m.insert("fire", "FIRE BED");
    m.insert("water", "WATERBED");
    m
}

pub fn monster_chip_label(kind: &str) -> String {
    kind.to_uppercase()
}

pub fn potion_chip_label(id: &str) -> String {
    id.to_uppercase()
}

pub fn skill_chip_label(id: &str, rank: usize) -> String {
    format!("{} R{}", id.to_uppercase(), rank)
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
        }
    }
}

pub fn debug_screen() -> DebugInspectorState {
    DebugInspectorState::default()
}

/// Paints the live debug telemetry and entity inspector HUD overlay.
pub fn paint_debug(f: &mut UiFrame, state: &DebugInspectorState, bounds: Rect) {
    let panel_rect = Rect {
        x: bounds.x + 8.0,
        y: bounds.y + 8.0,
        w: 240.0,
        h: 180.0,
    };

    fill_rect(f, &panel_rect, Ui::SCRIM);
    stroke_rect(f, &panel_rect, Ui::GOLD, 1.0);

    // Title
    text(
        f,
        "DEBUG TELEMETRY",
        panel_rect.x + 8.0,
        panel_rect.y + 6.0,
        TextOpts {
            size: 8,
            colour: Some(Ui::HEADING),
            align: Align::Left,
            max: None,
        },
    );

    // Stats
    let lines = [
        format!("FPS: {:.1} ({:.2}ms)", state.fps, state.frame_time_ms),
        format!("MONSTERS: {}", state.monster_count),
        format!("FLOOR FX: {}", state.floor_fx_count),
        format!(
            "POS: ({:.1}, {:.1})",
            state.player_pos.0, state.player_pos.1
        ),
        format!("SPEED: {:.2}", state.player_speed),
        format!(
            "GOD: {} | NOCLIP: {}",
            if state.god_mode { "ON" } else { "OFF" },
            if state.noclip { "ON" } else { "OFF" }
        ),
    ];

    for (i, line) in lines.iter().enumerate() {
        text(
            f,
            line,
            panel_rect.x + 8.0,
            panel_rect.y + 24.0 + (i as f64 * 16.0),
            TextOpts {
                size: 8,
                colour: Some(Ui::TEXT),
                align: Align::Left,
                max: None,
            },
        );
    }
}
