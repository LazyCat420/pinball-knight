// Parity test suite for Card Material Styles.
// Replicates legacy/src/game/pinball-knight/render/card-styles.ts

use pk_gui::render::card_styles::{style_for_card, style_for_monster, CardStyleId};

#[test]
fn card_styles_monster_family_mapping() {
    assert_eq!(style_for_monster("zombie").id, CardStyleId::Bone);
    assert_eq!(style_for_monster("ghost").id, CardStyleId::Ink);
    assert_eq!(style_for_monster("brute").id, CardStyleId::Stone);
    assert_eq!(style_for_monster("spider").id, CardStyleId::Chitin);
    assert_eq!(style_for_monster("knight").id, CardStyleId::Iron);
    assert_eq!(style_for_monster("unknown_aberration").id, CardStyleId::Void);

    let bone = style_for_monster("zombie");
    assert_eq!(bone.imprint, "BONE RELIC");
}

#[test]
fn card_styles_card_id_prefix_mapping() {
    assert_eq!(style_for_card("zombie_bite").id, CardStyleId::Bone);
    assert_eq!(style_for_card("ghost_phase").id, CardStyleId::Ink);
    assert_eq!(style_for_card("stone_skin").id, CardStyleId::Stone);
    assert_eq!(style_for_card("chitin_armor").id, CardStyleId::Chitin);
    assert_eq!(style_for_card("blade_flurry").id, CardStyleId::Iron);
    assert_eq!(style_for_card("void_rift").id, CardStyleId::Void);
}
