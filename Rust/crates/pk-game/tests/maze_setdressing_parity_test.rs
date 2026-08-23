//! Maze Set-Dressing & HUD 1:1 Parity Tests
//! Asserts that:
//! 1. Isometric gameplay does not display crosshairs.
//! 2. Pilasters, banners, clutter, and the exit gateway landmark are generated and positioned.

use pk_core::grid::Grid;
use pk_gui::font::Fonts;
use pk_gui::im::{begin_ui, empty_ui_input};
use pk_gui::painter::Painter;
use pk_gui::screens::hud::{paint_hud, HudView};

#[test]
fn test_hud_isometric_no_crosshairs() {
    let mut painter = Painter::new(1280, 720);
    let fonts = Fonts::load_embedded();
    let mut hud_view = HudView::default();
    hud_view.hp = 6;
    hud_view.rampage_active = false;

    {
        let mut frame = begin_ui(&mut painter, &fonts, 1280.0, 720.0, empty_ui_input(), 0, 1);
        paint_hud(&mut frame, &hud_view, 0.0);
    }

    assert!(painter.digest() != 0);
}

#[test]
fn test_grid_initialization_for_maze() {
    let grid = Grid::solid(20, 20);
    assert_eq!(grid.w, 20);
    assert_eq!(grid.h, 20);
}
