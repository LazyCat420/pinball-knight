// Parity test suite for Embedded Self-Hosted Pixel Fonts.
// Replicates legacy/src/pixel/pixel-font.ts

use pk_gui::pixel_font::{PIXEL_FONT_LABEL, PIXEL_FONT_NUM, SPEC_LABEL, SPEC_NUMERAL};

#[test]
fn pixel_font_constants_match_spec() {
    assert_eq!(PIXEL_FONT_LABEL, "'Press Start 2P'");
    assert_eq!(PIXEL_FONT_NUM, "VT323");

    assert!(!SPEC_LABEL.is_numeral);
    assert_eq!(SPEC_LABEL.cell_step_px, 8);

    assert!(SPEC_NUMERAL.is_numeral);
    assert_eq!(SPEC_NUMERAL.cell_step_px, 16);
}
