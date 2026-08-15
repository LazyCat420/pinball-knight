// Parity test suite for Isometric Roulette Wheel Rasterizer.
// Replicates legacy/src/scenes/tavern/gambler/roulette-art.ts

use pk_gui::gambler::roulette_art::RouletteWheelMetrics;

#[test]
fn roulette_isometric_projection_roundtrip() {
    let metrics = RouletteWheelMetrics::new(200.0, 150.0, 100.0);

    let angle = 1.25; // radians
    let norm_r = 0.75;
    let lift = 15.0;

    let (screen_x, screen_y) = metrics.project_isometric(angle, norm_r, lift);
    let (recon_r, recon_angle) = metrics.unproject_isometric(screen_x, screen_y, lift);

    assert!((recon_r - norm_r).abs() < 1e-4);
    assert!((recon_angle - angle).abs() < 1e-4);
}
