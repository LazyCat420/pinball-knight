// Parity test suite for Game Over Death Screen UI.
// Replicates legacy/src/game/pinball-knight/gui/screens/game-over.ts

use pk_gui::font::Fonts;
use pk_gui::im::{begin_ui, empty_ui_input, rect, Pointer};
use pk_gui::painter::Painter;
use pk_gui::screens::game_over::{paint_game_over, GameOverAction, GameOverState, DESIGN_BOX_H};

#[test]
fn game_over_screen_paints_within_design_box_and_triggers_tavern() {
    let fonts = Fonts::load_embedded();
    let mut p = Painter::new(640, DESIGN_BOX_H as u32);

    let mut state = GameOverState {
        depth: 4,
        best_depth: 7,
        dropped_gold: 450,
        player_name: "SirGalahad".to_string(),
        is_record: false,
    };

    let bounds = rect(0.0, 0.0, 640.0, DESIGN_BOX_H);

    // Frame 1: Paint without click
    let mut f1 = begin_ui(&mut p, &fonts, 640.0, DESIGN_BOX_H, empty_ui_input(), 0, 1);
    let action1 = paint_game_over(&mut f1, &mut state, bounds);
    assert_eq!(action1, None);

    // Frame 2: Click "BACK TO THE TAVERN" button
    let mut click_input = empty_ui_input();
    click_input.pointer = Pointer {
        x: 320.0,
        y: (DESIGN_BOX_H - 320.0) * 0.5 + 320.0 - 32.0,
        inside: true,
        down: true,
        pressed: true,
        released: false,
    };

    let mut f2 = begin_ui(&mut p, &fonts, 640.0, DESIGN_BOX_H, click_input, 0, 1);
    let action2 = paint_game_over(&mut f2, &mut state, bounds);
    assert_eq!(action2, Some(GameOverAction::BackToTavern));
}
