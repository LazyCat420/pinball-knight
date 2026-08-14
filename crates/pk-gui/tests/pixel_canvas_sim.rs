// Parity test suite for Integer Pixel Canvas Upscaler.
// Replicates legacy/src/pixel/pixel-canvas.ts

use pk_gui::pixel_canvas::{compute_pixel_fit, device_to_logical, logical_to_device};

#[test]
fn pixel_canvas_computes_exact_integer_scales() {
    // 1080p target (1920x1080) for 640x360 logical -> 3x scale exact (1920x1080)
    let fit_1080 = compute_pixel_fit(1920.0, 1080.0, 640, 360, 1, 8);
    assert_eq!(fit_1080.scale, 3);
    assert_eq!(fit_1080.offset_x, 0.0);
    assert_eq!(fit_1080.offset_y, 0.0);

    // 1440p target (2560x1440) for 640x360 logical -> 4x scale exact (2560x1440)
    let fit_1440 = compute_pixel_fit(2560.0, 1440.0, 640, 360, 1, 8);
    assert_eq!(fit_1440.scale, 4);
    assert_eq!(fit_1440.offset_x, 0.0);
    assert_eq!(fit_1440.offset_y, 0.0);

    // Ultrawide target (3440x1440) -> 4x scale (2560x1440) with letterbox pillarbox bars
    let fit_uw = compute_pixel_fit(3440.0, 1440.0, 640, 360, 1, 8);
    assert_eq!(fit_uw.scale, 4);
    assert_eq!(fit_uw.offset_x, (3440.0 - 2560.0) * 0.5);
    assert_eq!(fit_uw.offset_y, 0.0);
}

#[test]
fn pixel_canvas_coordinate_roundtrips() {
    let fit = compute_pixel_fit(1920.0, 1080.0, 640, 360, 1, 8); // 3x

    let logical_x = 100.0;
    let logical_y = 50.0;

    let (dev_x, dev_y) = logical_to_device(logical_x, logical_y, &fit);
    assert_eq!(dev_x, 300.0);
    assert_eq!(dev_y, 150.0);

    let (unproj_x, unproj_y) = device_to_logical(dev_x, dev_y, &fit);
    assert_eq!(unproj_x, logical_x);
    assert_eq!(unproj_y, logical_y);
}
