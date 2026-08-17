//! Debug Telemetry & Engine Inspector Screen.
//!
//! PORTS-PARTIAL: `gui/screens/debug.ts` - NOT a finished port - 74 rust code lines against 378 legacy (20%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

use crate::im::{fill_rect, stroke_rect, text, Align, Rect, TextOpts, UiFrame};
use crate::theme::Ui;

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

    let lines = [
        format!("FPS: {:.1} ({:.2} ms)", state.fps, state.frame_time_ms),
        format!("MONSTERS: {}", state.monster_count),
        format!("FLOOR FX: {}", state.floor_fx_count),
        format!(
            "POS: ({:.2}, {:.2})",
            state.player_pos.0, state.player_pos.1
        ),
        format!("SPEED: {:.2}", state.player_speed),
        format!("GOD MODE: {}", if state.god_mode { "ON" } else { "OFF" }),
        format!("NOCLIP: {}", if state.noclip { "ON" } else { "OFF" }),
    ];

    for (i, line) in lines.iter().enumerate() {
        text(
            f,
            line,
            panel_rect.x + 8.0,
            panel_rect.y + 24.0 + (i as f64 * 18.0),
            TextOpts {
                size: 8,
                colour: Some(Ui::TEXT),
                align: Align::Left,
                max: None,
            },
        );
    }
}
