// Parity simulation test suite for Pixel Pass Post-Processing & Sizing.
// Replicates legacy/src/game/pinball-knight/engine/render/pixel-pass.ts

use pk_game::post::sizing::*;

#[test]
fn compute_render_sizing_oracle_cases() {
    // 1080p window at zoom 1.0 -> 1920x1080 render grid at scale 1
    let s_1080p = compute_render_sizing(1920.0, 1080.0, 1.0);
    assert_eq!(s_1080p.scale, 1);
    assert_eq!(s_1080p.render_w, 1920);
    assert_eq!(s_1080p.render_h, 1080);
    assert!(!s_1080p.capped);

    // 720p window -> 1280x720 render grid at scale 1
    let s_720p = compute_render_sizing(1280.0, 720.0, 1.0);
    assert_eq!(s_720p.scale, 1);
    assert_eq!(s_720p.render_w, 1280);
    assert_eq!(s_720p.render_h, 720);

    // 4K window (3840x2160) -> integer scale 3 -> 1280x720 render grid
    let s_4k = compute_render_sizing(3840.0, 2160.0, 1.0);
    assert_eq!(s_4k.scale, 3);
    assert_eq!(s_4k.render_w, 1280);
    assert_eq!(s_4k.render_h, 720);
    assert_eq!(s_4k.out_w, 3840);
    assert_eq!(s_4k.out_h, 2160);
}

#[test]
fn zoom_helpers_and_browser_zoom_cancellation() {
    assert_eq!(snap_zoom_step(1.02), 1.0);
    assert_eq!(snap_zoom_step(1.09), 1.1);
    assert_eq!(snap_zoom_step(0.74), 0.75);

    let baseline = zoom_baseline(2.0, 1920.0, 1920.0);
    assert_eq!(baseline, 2.0);

    let b_zoom = browser_zoom(2.0, baseline);
    assert_eq!(b_zoom, 1.0);

    assert_eq!(cancel_browser_zoom(), 1.0);
}

#[test]
fn pixel_pass_construction_and_frustum() {
    let _pass = create_pixel_pass();
    let sizing = PixelSizing {
        render_w: 1920,
        render_h: 1080,
        scale: 1,
        out_w: 1920,
        out_h: 1080,
        capped: false,
    };

    let (fw, fh): (f32, f32) = sizing.frustum(1.0);
    assert!((fw - 1920.0f32 / 56.0f32).abs() < 1e-4);
    assert!((fh - 1080.0f32 / 56.0f32).abs() < 1e-4);

    let texel: f32 = sizing.texel(1.0);
    assert!((texel - 1.0f32 / 56.0f32).abs() < 1e-6);
}
