// Parity test suite for Lobby Character Select Screen.
// Replicates legacy/src/game/pinball-knight/gui/screens/character-select.ts

use pk_gui::font::Fonts;
use pk_gui::im::{begin_ui, empty_ui_input, rect, Pointer};
use pk_gui::painter::Painter;
use pk_gui::screens::character_select::{paint_character_select, CharacterSelectState};

#[test]
fn character_select_paints_and_confirms_champion() {
    let fonts = Fonts::load_embedded();
    let mut p = Painter::new(640, 338);

    let mut state = CharacterSelectState::default();
    let bounds = rect(0.0, 0.0, 640.0, 338.0);

    // Frame 1: Paint initial
    let mut f1 = begin_ui(&mut p, &fonts, 640.0, 338.0, empty_ui_input(), 0, 1);
    let action1 = paint_character_select(&mut f1, &mut state, bounds);
    assert_eq!(action1, None);

    // Frame 2: Click confirm button
    let mut click_input = empty_ui_input();
    click_input.pointer = Pointer {
        x: 320.0,
        y: 338.0 - 40.0,
        inside: true,
        down: true,
        pressed: true,
        released: false,
    };

    let mut f2 = begin_ui(&mut p, &fonts, 640.0, 338.0, click_input, 0, 1);
    let action2 = paint_character_select(&mut f2, &mut state, bounds);
    assert_eq!(action2, Some("knight".to_string()));
}
