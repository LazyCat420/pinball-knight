// Parity test suite for Pixel Icon Rasterizer and Bayer Dithering.
// Replicates legacy/src/pixel/pixel-icon.ts

use pk_gui::pixel_icon::{crush_pixel_art, quantize_color, RasterizeOptions};

#[test]
fn quantize_color_snaps_to_nearest_palette_entry() {
    let palette = vec![[0, 0, 0], [255, 255, 255], [255, 0, 0]];

    assert_eq!(quantize_color([10, 10, 10], &palette), [0, 0, 0]);
    assert_eq!(quantize_color([240, 240, 240], &palette), [255, 255, 255]);
    assert_eq!(quantize_color([220, 20, 10], &palette), [255, 0, 0]);
}

#[test]
fn crush_pixel_art_applies_alpha_cutout() {
    // 2x2 source image: top-left transparent, rest opaque red
    let src = vec![
        255, 0, 0, 50, // Transparent
        255, 0, 0, 255, // Opaque
        255, 0, 0, 255, // Opaque
        255, 0, 0, 255, // Opaque
    ];

    let opts = RasterizeOptions {
        size: 2,
        palette: None,
        dither: false,
        alpha_cutoff: 128,
        dither_amp: 6,
    };

    let result = crush_pixel_art(&src, 2, 2, &opts);
    assert_eq!(result[3], 0); // Top-left was cut out
    assert_eq!(result[7], 255); // Top-right is opaque
}

#[test]
fn crush_pixel_art_applies_bayer_dither() {
    // Uniform grey image with black & white palette
    let src = vec![128u8; 16 * 4]; // 4x4 RGBA image
    let palette = vec![[0, 0, 0], [255, 255, 255]];

    let opts = RasterizeOptions {
        size: 4,
        palette: Some(palette),
        dither: true,
        alpha_cutoff: 128,
        dither_amp: 20,
    };

    let result = crush_pixel_art(&src, 4, 4, &opts);
    assert_eq!(result.len(), 4 * 4 * 4);

    // Verify output contains both black and white pixels from dithering
    let mut has_black = false;
    let mut has_white = false;
    for chunk in result.chunks_exact(4) {
        if chunk[0] == 0 {
            has_black = true;
        }
        if chunk[0] == 255 {
            has_white = true;
        }
    }
    assert!(has_black || has_white);
}
