// Parity test suite for Pixel Fonts Compatibility Barrel.
// Replicates legacy/src/game/pinball-knight/pixel-fonts.ts

use pk_gui::pixel_fonts::{
    ensure_pixel_fonts, label_font, num_font, PIXEL_FONT_LABEL, PIXEL_FONT_NUM, SPEC_LABEL,
    SPEC_NUMERAL,
};

#[test]
fn pixel_fonts_barrel_exposes_font_faces_and_specs() {
    ensure_pixel_fonts();

    assert_eq!(label_font(), PIXEL_FONT_LABEL);
    assert_eq!(num_font(), PIXEL_FONT_NUM);

    assert_eq!(SPEC_LABEL.family, PIXEL_FONT_LABEL);
    assert!(!SPEC_LABEL.is_numeral);
    assert_eq!(SPEC_LABEL.cell_step_px, 8);

    assert_eq!(SPEC_NUMERAL.family, PIXEL_FONT_NUM);
    assert!(SPEC_NUMERAL.is_numeral);
    assert_eq!(SPEC_NUMERAL.cell_step_px, 16);
}
