// Parity test suite for Palette to LINEAR Color Converters.
// Replicates legacy/src/game/pinball-knight/fx/color.ts

use pk_core::fx::color::{lin_color, pal_lin, to_linear, PALETTE_SIZE};

#[test]
fn to_linear_matches_exact_piecewise_curve() {
    assert_eq!(to_linear(0.0), 0.0);
    assert!((to_linear(1.0) - 1.0).abs() < 1e-6);

    // Below and above piecewise split (0.04045)
    let low = to_linear(0.04);
    assert!((low - 0.04 / 12.92).abs() < 1e-6);

    let mid = to_linear(0.5);
    assert!((mid - ((0.5 + 0.055) / 1.055_f32).powf(2.4)).abs() < 1e-6);
}

#[test]
fn lin_color_converts_hex_triplets() {
    let black = lin_color(0x000000);
    assert_eq!(black, [0.0, 0.0, 0.0]);

    let white = lin_color(0xffffff);
    assert!((white[0] - 1.0).abs() < 1e-6);
    assert!((white[1] - 1.0).abs() < 1e-6);
    assert!((white[2] - 1.0).abs() < 1e-6);
}

#[test]
fn pal_lin_resolves_all_palette_entries() {
    for i in 0..PALETTE_SIZE {
        let rgb = pal_lin(i);
        for channel in rgb {
            assert!(channel >= 0.0 && channel <= 1.0);
        }
    }
}
