//! Parity test suite for gui/im.ts immediate-mode layout, geometry, and widgets.

use pk_gui::font::Fonts;
use pk_gui::im::*;
use pk_gui::painter::Painter;

#[test]
fn rect_geometry_operations() {
    let mut r = rect(10.0, 20.0, 100.0, 50.0);
    assert!(hit(&r, 15.0, 25.0));
    assert!(!hit(&r, 5.0, 25.0));
    assert!(!hit(&r, 115.0, 25.0));

    let ins = inset(&r, 5.0);
    assert_eq!(ins, rect(15.0, 25.0, 90.0, 40.0));

    let top = cut_top(&mut r, 10.0);
    assert_eq!(top, rect(10.0, 20.0, 100.0, 10.0));
    assert_eq!(r, rect(10.0, 30.0, 100.0, 40.0));

    let left = cut_left(&mut r, 20.0);
    assert_eq!(left, rect(10.0, 30.0, 20.0, 40.0));
    assert_eq!(r, rect(30.0, 30.0, 80.0, 40.0));

    let right = cut_right(&mut r, 15.0);
    assert_eq!(right, rect(95.0, 30.0, 15.0, 40.0));
    assert_eq!(r, rect(30.0, 30.0, 65.0, 40.0));
}

#[test]
fn focus_math_and_clamping() {
    assert_eq!(clamp_focus(0, 5), 0);
    assert_eq!(clamp_focus(4, 5), 4);
    assert_eq!(clamp_focus(5, 5), 4);
    assert_eq!(clamp_focus(-1, 5), 0);
    assert_eq!(clamp_focus(0, 0), 0);
}

#[test]
fn scroll_view_calculations() {
    let view = rect(0.0, 0.0, 100.0, 200.0);
    let widget_below = rect(0.0, 250.0, 100.0, 30.0);
    let new_offset = scroll_to_show(&view, &widget_below, 0.0);
    assert!(new_offset > 0.0);

    let widget_above = rect(0.0, 50.0, 100.0, 30.0);
    let new_offset_up = scroll_to_show(&view, &widget_above, 100.0);
    assert!(new_offset_up < 100.0);
}

#[test]
fn text_wrapping_and_ellipsizing() {
    let mut painter = Painter::new(100, 100);
    let fonts = Fonts::load_embedded();
    let input = empty_ui_input();
    let frame = begin_ui(&mut painter, &fonts, 800.0, 600.0, input, 0, 1);

    let short_str = "hello";
    assert_eq!(ellipsize(&frame, short_str, 200.0, 8), "hello");

    let long_str = "the quick brown fox jumps over the lazy dog in the dungeon";
    let wrapped = wrap(&frame, long_str, 80.0, 8);
    assert!(wrapped.len() > 1);
}

#[test]
fn immediate_mode_button_widget() {
    let mut painter = Painter::new(100, 100);
    let fonts = Fonts::load_embedded();
    let mut input = empty_ui_input();
    input.accept = true;

    let mut frame = begin_ui(&mut painter, &fonts, 800.0, 600.0, input, 0, 1);
    let r = rect(10.0, 10.0, 100.0, 30.0);

    let clicked = button(&mut frame, &r, "Test Button", ButtonOpts::default());
    assert!(clicked);
}

#[test]
fn immediate_mode_toggle_and_tabs() {
    let mut painter = Painter::new(100, 100);
    let fonts = Fonts::load_embedded();
    let mut input = empty_ui_input();
    input.accept = true;

    let mut frame = begin_ui(&mut painter, &fonts, 800.0, 600.0, input, 0, 1);
    let r = rect(10.0, 10.0, 100.0, 30.0);

    let toggled = toggle(&mut frame, &r, false, ("ON", "OFF"));
    assert!(toggled);

    let active_tab = tabs(&mut frame, &r, &["TAB1", "TAB2"], 0);
    assert_eq!(active_tab, 0);
}
