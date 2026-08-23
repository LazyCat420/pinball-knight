// Parity test suite for Window to UI Pixel Coordinates.
// Replicates legacy/src/game/pinball-knight/gui/coords.ts

use pk_gui::coords::{canvas_origin, screen_to_ui, UiSizing};

#[test]
fn canvas_origin_floors_letterbox_offsets() {
    let sizing = UiSizing {
        scale: 2.0,
        css_scale: 2.0,
        render_w: 400.0,
        render_h: 225.0,
        out_w: 800.0,
        out_h: 450.0,
    };

    // Odd window dimensions 1921 x 1081
    let (left, top) = canvas_origin(&sizing, 1921.0, 1081.0);
    // (1921 - 800) / 2 = 560.5 -> 560.0
    assert_eq!(left, 560.0);
    // (1081 - 450) / 2 = 315.5 -> 315.0
    assert_eq!(top, 315.0);
}

#[test]
fn screen_to_ui_maps_inside_and_outside_points() {
    let sizing = UiSizing {
        scale: 2.0,
        css_scale: 2.0,
        render_w: 400.0,
        render_h: 225.0,
        out_w: 800.0,
        out_h: 450.0,
    };

    // Window 1000 x 600 -> canvas css is 800 x 450 -> left = 100, top = 75
    let center = screen_to_ui(500.0, 300.0, &sizing, 1000.0, 600.0);
    assert_eq!(center.x, 200.0); // (500 - 100) / 2
    assert_eq!(center.y, 112.5); // (300 - 75) / 2
    assert!(center.inside);

    // Letterbox margin click (top margin at y=20)
    let margin = screen_to_ui(500.0, 20.0, &sizing, 1000.0, 600.0);
    assert!(!margin.inside);
    assert!(margin.y < 0.0);
}
