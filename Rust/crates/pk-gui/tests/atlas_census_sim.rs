// Parity test suite for Atlas Noise Census.
// Replicates legacy/src/game/pinball-knight/render/atlas-census.ts

use pk_gui::render::atlas_census::census_cell;

#[test]
fn atlas_census_clean_sprite_metrics() {
    let palette = vec![[255, 0, 0], [0, 255, 0]];
    let mut rgba = vec![0u8; 4 * 4 * 4];

    // Row 0: 4 red pixels
    for i in 0..4 {
        let idx = (0 * 4 + i) * 4;
        rgba[idx] = 255;
        rgba[idx + 1] = 0;
        rgba[idx + 2] = 0;
        rgba[idx + 3] = 255;
    }

    let stats = census_cell(&rgba, 4, 4, &palette);
    assert_eq!(stats.opaque, 4);
    assert_eq!(stats.unmatched, 0);
    assert_eq!(stats.entries, 1);
    assert_eq!(stats.isolated_pct, 0.0); // 4 connected pixels in a line have neighbours
    assert_eq!(stats.run_len, 4.0);
}

#[test]
fn atlas_census_isolated_noise_pixel() {
    let palette = vec![[0, 255, 0]];
    let mut rgba = vec![0u8; 4 * 4 * 4];

    // Single green pixel at (1, 1)
    let idx = (1 * 4 + 1) * 4;
    rgba[idx] = 0;
    rgba[idx + 1] = 255;
    rgba[idx + 2] = 0;
    rgba[idx + 3] = 200; // Above cutoff 127

    let stats = census_cell(&rgba, 4, 4, &palette);
    assert_eq!(stats.opaque, 1);
    assert_eq!(stats.unmatched, 0);
    assert_eq!(stats.isolated_pct, 100.0); // Isolated noise pixel
    assert_eq!(stats.run_len, 1.0);
}
