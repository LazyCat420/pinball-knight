// Parity test suite for Hard-Edged Alpha-Thresholded Canvas Pixel Text.
// Replicates legacy/src/pixel/pixel-text.ts

use pk_gui::pixel_text::{
    measure_pixel_text, resolve_text_origin, threshold_alpha_buffer, PixelTextAlign, ALPHA_CUT,
};

#[test]
fn threshold_alpha_buffer_cleans_anti_aliasing_fringes() {
    assert_eq!(ALPHA_CUT, 96);

    let mut rgba = vec![
        255, 255, 255, 95, // Just below cutoff -> 0
        255, 255, 255, 96, // At cutoff -> 255
        255, 255, 255, 120, // Above cutoff -> 255
        255, 255, 255, 10, // Far below -> 0
    ];

    threshold_alpha_buffer(&mut rgba);

    assert_eq!(rgba[3], 0);
    assert_eq!(rgba[7], 255);
    assert_eq!(rgba[11], 255);
    assert_eq!(rgba[15], 0);
}

#[test]
fn text_measurement_and_alignment_resolution() {
    let width = measure_pixel_text(8, "FLOOR 1");
    assert!(width > 0);

    // Left alignment anchors directly at x
    assert_eq!(resolve_text_origin(100, width, PixelTextAlign::Left), 100);

    // Center alignment offsets by half width
    assert_eq!(
        resolve_text_origin(100, width, PixelTextAlign::Center),
        100 - (width as i32 / 2)
    );

    // Right alignment offsets by full width
    assert_eq!(
        resolve_text_origin(100, width, PixelTextAlign::Right),
        100 - width as i32
    );
}
