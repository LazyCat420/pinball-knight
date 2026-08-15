// Parity test suite for Palette Source.
// Replicates legacy/src/game/pinball-knight/engine/palette-source.ts

use pk_gui::render::palette_source::PaletteSource;

#[test]
fn cold_crypt_palette_source_attributes_and_conversions() {
    let pal = PaletteSource::cold_crypt();
    assert_eq!(pal.size, 32);
    assert_eq!(pal.occlusion_index, 30);
    assert!((pal.dither_strength() - 0.0625).abs() < 1e-4);

    let floats = pal.to_float_array();
    assert_eq!(floats.len(), 32 * 3);

    assert_eq!(pal.css(0), "#000000");
    assert_eq!(pal.css(7), "#ffffff");
}

#[test]
fn fallback_greyscale_palette_source() {
    let pal = PaletteSource::fallback_greyscale();
    assert_eq!(pal.size, 16);
    assert_eq!(pal.occlusion_index, 10);
    assert!((pal.dither_strength() - 0.125).abs() < 1e-4);

    assert_eq!(pal.css(0), "#000000");
    assert_eq!(pal.css(15), "#ffffff");
}
