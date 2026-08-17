//! Comprehensive parity test suite for legacy/src/game/pinball-knight/engine/render/pixel-pass.ts.

use pk_game::post::sizing::*;

#[test]
fn zoom_and_browser_scaling_functions() {
    assert_eq!(snap_zoom_step(1.0), 1.0);
    assert_eq!(snap_zoom_step(1.25), 1.25);
    assert_eq!(snap_zoom_step(1.5), 1.5);
    assert_eq!(snap_zoom_step(2.0), 2.0);

    let baseline = zoom_baseline(1.0, 1920.0, 1920.0);
    assert_eq!(baseline, 1.0);

    let zoom = browser_zoom(1.25, 1.0);
    assert_eq!(zoom, 1.0);

    let cancel = cancel_browser_zoom();
    assert_eq!(cancel, 1.0);
}

#[test]
fn render_sizing_and_integer_multipliers() {
    let sizing: RenderSizing = compute_render_sizing(1920.0, 1080.0, 1.0);
    assert!(sizing.render_w > 0);
    assert!(sizing.render_h > 0);
    assert!(sizing.scale >= 1);
    assert_eq!(sizing.render_w % 2, 0);
    assert_eq!(sizing.render_h % 2, 0);
}
