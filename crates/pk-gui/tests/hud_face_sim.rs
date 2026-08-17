//! Comprehensive test suite for legacy/src/game/pinball-knight/hud-face.ts.

use pk_gui::hud_face::*;

#[test]
fn hud_face_constants_and_dimensions() {
    assert_eq!(GRID, 36);
    assert_eq!(SCALE, 2);
    assert_eq!(FACE_PX, 72);
}

#[test]
fn hud_face_health_tiers_and_expressions() {
    let mut face = create_face();
    set_face_health(&mut face, 6.0, 6.0);
    assert_eq!(face.tier_of(), FaceExpr::Fresh);

    set_face_health(&mut face, 4.5, 6.0);
    assert_eq!(face.tier_of(), FaceExpr::Steady);

    set_face_health(&mut face, 3.0, 6.0);
    assert_eq!(face.tier_of(), FaceExpr::Hurt);

    set_face_health(&mut face, 1.8, 6.0);
    assert_eq!(face.tier_of(), FaceExpr::Bloodied);

    set_face_health(&mut face, 0.8, 6.0);
    assert_eq!(face.tier_of(), FaceExpr::Dying);

    set_face_health(&mut face, 0.0, 6.0);
    assert_eq!(face.tier_of(), FaceExpr::Dead);
}

#[test]
fn hud_face_damage_heal_and_special_reactions() {
    let mut face = create_face();

    // Damage reaction with angle glance
    face_on_damage(&mut face, Some(0.0));
    assert!(face.pain_t > 0.0);
    assert_eq!(face.expr_now(), FaceMood::Wince);
    assert_eq!(face.turn, 1);

    // Render step decays pain
    render_face(&mut face, 0.4);
    assert_eq!(face.pain_t, 0.0);

    // Heal reaction
    face_on_heal(&mut face);
    assert!(face.heal_t > 0.0);
    assert_eq!(face.expr_now(), FaceMood::Smile);

    render_face(&mut face, 0.5);
    assert_eq!(face.heal_t, 0.0);

    // Special reaction
    face_on_special(&mut face);
    assert!(face.special_t > 0.0);
    assert_eq!(face.expr_now(), FaceMood::Grin);
}

#[test]
fn hud_face_dead_portrait_and_contact_sheet() {
    let dead = dead_face();
    assert_eq!(dead.tier_of(), FaceExpr::Dead);
    assert_eq!(dead.pixels.len(), FACE_PX * FACE_PX * 4);

    let sheet = face_contact_sheet();
    assert_eq!(sheet.len(), 6);
    assert_eq!(sheet[0].tier_of(), FaceExpr::Fresh);
    assert_eq!(sheet[5].tier_of(), FaceExpr::Dead);
}
