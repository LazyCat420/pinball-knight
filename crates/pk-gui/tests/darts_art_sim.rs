// Parity test suite for Dartboard Hand-Rasterized Pixel Art.
// Replicates legacy/src/scenes/tavern/gambler/darts-art.ts

use pk_gui::gambler::darts_art::{classify_dartboard_pixel, DartboardPixelKind};

#[test]
fn darts_art_pixel_concentric_classification() {
    assert_eq!(
        classify_dartboard_pixel(0.0, 0.0),
        DartboardPixelKind::BullseyeInner
    );

    assert_eq!(
        classify_dartboard_pixel(0.06, 0.0),
        DartboardPixelKind::BullseyeOuter
    );

    assert_eq!(
        classify_dartboard_pixel(0.60, 0.0),
        DartboardPixelKind::TrebleRing
    );

    assert_eq!(
        classify_dartboard_pixel(0.97, 0.0),
        DartboardPixelKind::DoubleRing
    );

    assert_eq!(
        classify_dartboard_pixel(1.20, 0.0),
        DartboardPixelKind::Surround
    );

    assert_eq!(
        classify_dartboard_pixel(1.50, 0.0),
        DartboardPixelKind::Outside
    );
}
