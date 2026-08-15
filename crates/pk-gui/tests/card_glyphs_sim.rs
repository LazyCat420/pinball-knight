// Parity test suite for Card Vector Glyphs.
// Replicates legacy/src/game/pinball-knight/render/card-glyphs.ts

use pk_gui::render::card_glyphs::{
    get_card_glyph, glyph_fire, glyph_frost, glyph_heart, glyph_shield, glyph_skull, glyph_sword,
};

#[test]
fn card_glyphs_fit_within_unit_bounds() {
    let glyphs = vec![
        ("sword", glyph_sword()),
        ("shield", glyph_shield()),
        ("fire", glyph_fire()),
        ("frost", glyph_frost()),
        ("heart", glyph_heart()),
        ("skull", glyph_skull()),
    ];

    for (name, pts) in glyphs {
        assert!(!pts.is_empty(), "glyph {} is empty", name);
        for &(x, y) in &pts {
            assert!(
                x >= -1.05 && x <= 1.05 && y >= -1.05 && y <= 1.05,
                "glyph {} point ({}, {}) exceeds unit bounds",
                name,
                x,
                y
            );
        }
    }

    assert!(get_card_glyph("sword").is_some());
    assert!(get_card_glyph("armor").is_some());
    assert!(get_card_glyph("unknown_mark").is_none());
}
