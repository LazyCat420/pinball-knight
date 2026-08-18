//! Floor Map Screen — Non-pausing tactical dungeon floor map overlay with HUD clearance.
//!
//! PORTS: `gui/screens/floor-map.ts`

use crate::im::Rect;

pub const SCRIM_COLOR: &str = "rgba(11,13,18,0.62)";

pub const LEGEND: &[(&str, &str)] = &[
    ("#ffd700", "YOU"),
    ("#7852ff", "STAIRS"),
    ("#2ecc71", "PARTS"),
    ("#a46fe8", "SECRET"),
];

/// The floor map overlay NEVER pauses the game, ensuring tactical mid-run checks carry real risk.
pub fn floor_map_pauses_game() -> bool {
    false
}

/// Computes the active map viewport rect, reserving padding around borders and leaving the HUD panel clear below.
pub fn compute_map_viewport(
    screen_w: f64,
    screen_h: f64,
    pad: f64,
    hud_panel_h: f64,
    hud_zoom: f64,
) -> Rect {
    let hud_h = hud_panel_h * hud_zoom;
    let avail_h = (screen_h - hud_h - pad * 2.0).max(10.0);
    let avail_w = (screen_w - pad * 2.0).max(10.0);

    Rect {
        x: pad,
        y: pad,
        w: avail_w,
        h: avail_h,
    }
}

/// Toggles floor map overlay state.
pub fn toggle_floor_map_screen(overlay: &mut crate::map_overlay::MapOverlayState) -> bool {
    overlay.toggle_floor_map()
}

/// Closes the floor map screen if currently open.
pub fn close_floor_map_screen(overlay: &mut crate::map_overlay::MapOverlayState) {
    overlay.close_floor_map();
}

pub fn floor_map_screen() -> crate::map_overlay::MapOverlayState {
    crate::map_overlay::MapOverlayState::default()
}
