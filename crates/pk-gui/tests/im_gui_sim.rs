// Parity test suite for Immediate-Mode GUI Engine.
// Replicates legacy/src/game/pinball-knight/gui/im.ts

use pk_gui::font::Fonts;
use pk_gui::im::*;
use pk_gui::painter::Painter;

#[test]
fn rect_geometry_slicing_and_insetting() {
    let r = rect(10.0, 20.0, 100.0, 50.0);
    assert!(hit(&r, 15.0, 25.0));
    assert!(!hit(&r, 5.0, 25.0));
    assert!(!hit(&r, 15.0, 75.0));

    let ins = inset(&r, 5.0);
    assert_eq!(ins, rect(15.0, 25.0, 90.0, 40.0));

    let mut r_mut = r;
    let top = cut_top(&mut r_mut, 10.0);
    assert_eq!(top, rect(10.0, 20.0, 100.0, 10.0));
    assert_eq!(r_mut, rect(10.0, 30.0, 100.0, 40.0));

    let left = cut_left(&mut r_mut, 20.0);
    assert_eq!(left, rect(10.0, 30.0, 20.0, 40.0));
    assert_eq!(r_mut, rect(30.0, 30.0, 80.0, 40.0));

    let right = cut_right(&mut r_mut, 15.0);
    assert_eq!(right, rect(95.0, 30.0, 15.0, 40.0));
    assert_eq!(r_mut, rect(30.0, 30.0, 65.0, 40.0));
}

#[test]
fn focus_navigation_and_clamping() {
    let fonts = Fonts::load_embedded();
    let mut p = Painter::new(100, 100);
    let mut f = begin_ui(&mut p, &fonts, 100.0, 100.0, empty_ui_input(), 0, 1);

    let r1 = rect(0.0, 0.0, 50.0, 20.0);
    let r2 = rect(0.0, 20.0, 50.0, 20.0);
    let r3 = rect(0.0, 40.0, 50.0, 20.0);

    let st1 = focusable(&mut f, &r1, false);
    let _st2 = focusable(&mut f, &r2, true); // disabled
    let _st3 = focusable(&mut f, &r3, false);

    assert!(st1.focused);
    assert_eq!(move_focus(&f, 1), 2); // skips disabled index 1 -> lands on 2
    assert_eq!(move_focus(&f, -1), 2); // wraps backwards to 2

    assert_eq!(clamp_focus(5, 3), 2);
    assert_eq!(clamp_focus(-1, 3), 0);
}

#[test]
fn interactive_widgets_execution() {
    let fonts = Fonts::load_embedded();
    let mut p = Painter::new(200, 200);

    // Test Button Click with Accept Input
    let mut input = empty_ui_input();
    input.accept = true;
    let mut f_btn = begin_ui(&mut p, &fonts, 200.0, 200.0, input.clone(), 0, 1);
    let btn_rect = rect(10.0, 10.0, 80.0, 24.0);
    let clicked = button(&mut f_btn, &btn_rect, "Play", ButtonOpts::default());
    assert!(clicked);
    drop(f_btn);

    // Test Toggle with focus on index 0
    let mut f_tog = begin_ui(&mut p, &fonts, 200.0, 200.0, input.clone(), 0, 1);
    let toggle_rect = rect(10.0, 40.0, 80.0, 24.0);
    let toggled = toggle(&mut f_tog, &toggle_rect, false, ("ON", "OFF"));
    assert!(toggled); // activated with accept input
    drop(f_tog);

    // Test Slider
    let mut f_sld = begin_ui(&mut p, &fonts, 200.0, 200.0, empty_ui_input(), 0, 1);
    let slider_rect = rect(10.0, 70.0, 80.0, 24.0);
    let val = slider(&mut f_sld, &slider_rect, 0.5, 4);
    assert_eq!(val, 0.5);
    drop(f_sld);

    // Test Tabs
    let mut f_tabs = begin_ui(&mut p, &fonts, 200.0, 200.0, empty_ui_input(), 0, 1);
    let tab_rect = rect(10.0, 100.0, 120.0, 24.0);
    let active_tab = tabs(&mut f_tabs, &tab_rect, &["Audio", "Video", "Input"], 0);
    assert_eq!(active_tab, 0);
}

#[test]
fn text_layout_and_wrapping() {
    let fonts = Fonts::load_embedded();
    let mut p1 = Painter::new(100, 100);
    let f = begin_ui(&mut p1, &fonts, 100.0, 100.0, empty_ui_input(), 0, 1);

    let short_str = "Knight";
    assert_eq!(ellipsize(&f, short_str, 50.0, 8), "Knight");

    let long_str = "A very long dungeon descriptor text that exceeds width";
    let wrapped = wrap(&f, long_str, 60.0, 8);
    assert!(wrapped.len() > 1);
    drop(f);

    // Text field input
    let mut input = empty_ui_input();
    input.typed = "abc\u{8}d".to_string(); // "ab" + backspace + "d" -> "abd"
    let mut p2 = Painter::new(100, 100);
    let mut f_text = begin_ui(&mut p2, &fonts, 100.0, 100.0, input, 0, 1);
    let tf_rect = rect(10.0, 10.0, 80.0, 20.0);
    let result = text_field(&mut f_text, &tf_rect, "X", 10, true);
    assert_eq!(result, "XABD");
}

#[test]
fn scroll_container_mechanics() {
    let fonts = Fonts::load_embedded();
    let mut p = Painter::new(200, 200);
    let mut f = begin_ui(&mut p, &fonts, 200.0, 200.0, empty_ui_input(), 0, 1);

    let view = rect(0.0, 0.0, 100.0, 100.0);
    let widget = rect(0.0, 150.0, 100.0, 20.0);

    let new_offset = scroll_to_show(&view, &widget, 0.0);
    // Needs to scroll down so widget at 150 is visible inside view height 100
    assert!(new_offset > 0.0);

    let handle = begin_scroll(&mut f, &view, 300.0, 50.0);
    assert_eq!(handle.inner.w, 100.0);
    assert_eq!(handle.inner.h, 300.0);
    end_scroll(&mut f, &view, 300.0, 50.0);
}
