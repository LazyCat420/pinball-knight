// Parity test suite for GUI In-Game Screens (Knight Menu, Settings, Floor Loading, Debug Telemetry).
// Replicates legacy/src/game/pinball-knight/gui/screens/menu.ts, settings.ts, floor-loading.ts, debug.ts

use pk_gui::font::Fonts;
use pk_gui::im::{begin_ui, empty_ui_input, rect, Rect};
use pk_gui::painter::Painter;
use pk_gui::screens::debug::{paint_debug, DebugInspectorState};
use pk_gui::screens::floor_loading::{paint_floor_loading, FloorLoadingState};
use pk_gui::screens::menu::{paint_menu, KnightMenuState, MenuTab};
use pk_gui::screens::settings::{paint_settings, UserSettings};

#[test]
fn knight_menu_paints_all_tabs_without_crashing() {
    let fonts = Fonts::load_embedded();
    let mut p = Painter::new(600, 338);

    for tab in MenuTab::ALL {
        let mut state = KnightMenuState {
            tab,
            focus_idx: 0,
            gold: 250,
            level: 3,
            skill_points: 2,
            hp: 80.0,
            max_hp: 100.0,
            active_weapon: "Iron Sword".to_string(),
            weapon_slots: vec!["Iron Sword".to_string(), "Rusty Dagger".to_string()],
        };

        let mut f = begin_ui(&mut p, &fonts, 600.0, 338.0, empty_ui_input(), 0, 1);
        let bounds = rect(20.0, 20.0, 560.0, 298.0);
        paint_menu(&mut f, &mut state, bounds);
    }
}

#[test]
fn settings_screen_paints_sliders_and_toggles() {
    let fonts = Fonts::load_embedded();
    let mut p = Painter::new(600, 338);

    let mut settings = UserSettings {
        master_volume: 0.5,
        sfx_volume: 0.8,
        music_volume: 0.4,
        screen_shake: true,
        damage_numbers: false,
        pixel_scale: 2,
    };

    let mut f = begin_ui(&mut p, &fonts, 600.0, 338.0, empty_ui_input(), 0, 1);
    let bounds = rect(30.0, 30.0, 540.0, 278.0);
    paint_settings(&mut f, &mut settings, bounds);
}

#[test]
fn floor_loading_screen_paints_elevator_and_progress() {
    let fonts = Fonts::load_embedded();
    let mut p = Painter::new(600, 338);

    let state = FloorLoadingState {
        floor_num: 4,
        theme_title: "VAULT OF RUNES".to_string(),
        modifiers: vec!["Shock Floor".to_string(), "Elite Guardians".to_string()],
        progress: 0.65,
        tip: "Hit drop target banks in sequence to unlock secret rooms.".to_string(),
    };

    let mut f = begin_ui(&mut p, &fonts, 600.0, 338.0, empty_ui_input(), 0, 1);
    let bounds = rect(0.0, 0.0, 600.0, 338.0);
    paint_floor_loading(&mut f, &state, bounds);
}

#[test]
fn debug_inspector_paints_telemetry_metrics() {
    let fonts = Fonts::load_embedded();
    let mut p = Painter::new(600, 338);

    let state = DebugInspectorState {
        fps: 59.8,
        frame_time_ms: 16.72,
        monster_count: 14,
        floor_fx_count: 5,
        player_pos: (12.4, -8.6),
        player_speed: 4.85,
        god_mode: true,
        noclip: false,
    };

    let mut f = begin_ui(&mut p, &fonts, 600.0, 338.0, empty_ui_input(), 0, 1);
    let bounds = rect(0.0, 0.0, 600.0, 338.0);
    paint_debug(&mut f, &state, bounds);
}
