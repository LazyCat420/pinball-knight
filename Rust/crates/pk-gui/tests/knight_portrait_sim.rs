// Parity test suite for Knight Portrait Paperdoll Layout.
// Replicates legacy/src/game/pinball-knight/render/knight-portrait.ts

use pk_gui::render::knight_portrait::compute_portrait_fit;

#[test]
fn portrait_fit_calculates_centered_square_scale() {
    let fit = compute_portrait_fit(128, 128, 64);
    assert_eq!(fit.scale, 2.0);
    assert_eq!(fit.width, 128);
    assert_eq!(fit.height, 128);
    assert_eq!(fit.offset_x, 0);
    assert_eq!(fit.offset_y, 0);
}

#[test]
fn portrait_fit_handles_rectangular_aspect_ratios() {
    // Wide canvas: height constrained
    let fit_wide = compute_portrait_fit(200, 100, 50);
    assert_eq!(fit_wide.scale, 2.0);
    assert_eq!(fit_wide.width, 100);
    assert_eq!(fit_wide.height, 100);
    assert_eq!(fit_wide.offset_x, 50);
    assert_eq!(fit_wide.offset_y, 0);

    // Tall canvas: width constrained
    let fit_tall = compute_portrait_fit(100, 300, 50);
    assert_eq!(fit_tall.scale, 2.0);
    assert_eq!(fit_tall.width, 100);
    assert_eq!(fit_tall.height, 100);
    assert_eq!(fit_tall.offset_x, 0);
    assert_eq!(fit_tall.offset_y, 100);
}

#[test]
fn portrait_fit_guards_zero_dimensions() {
    let fit = compute_portrait_fit(0, 100, 50);
    assert_eq!(fit.width, 0);
    assert_eq!(fit.height, 0);
}
