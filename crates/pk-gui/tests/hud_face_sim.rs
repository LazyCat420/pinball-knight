// Parity test suite for Animated Knight Portrait & Face Renderer.
// Replicates legacy/src/game/pinball-knight/hud-face.ts

use pk_gui::hud_face::*;

#[test]
fn health_tiers_and_helmet_degradation_stages() {
    let mut face = FaceState::default();

    // Fresh (100%)
    face.set_health(100, 100);
    assert_eq!(face.tier_of(), Expr::Fresh);
    assert_eq!(face.helmet_stage_of(), 0);

    // Steady (75%)
    face.set_health(75, 100);
    assert_eq!(face.tier_of(), Expr::Steady);
    assert_eq!(face.helmet_stage_of(), 1);

    // Hurt (50%)
    face.set_health(50, 100);
    assert_eq!(face.tier_of(), Expr::Hurt);
    assert_eq!(face.helmet_stage_of(), 2);

    // Bloodied (30%)
    face.set_health(30, 100);
    assert_eq!(face.tier_of(), Expr::Bloodied);
    assert_eq!(face.helmet_stage_of(), 3);

    // Dying (15%)
    face.set_health(15, 100);
    assert_eq!(face.tier_of(), Expr::Dying);
    assert_eq!(face.helmet_stage_of(), 4);

    // Dead (0%)
    face.set_health(0, 100);
    assert_eq!(face.tier_of(), Expr::Dead);
    assert_eq!(face.helmet_stage_of(), 5);
}

#[test]
fn mood_triggers_and_priority() {
    let mut face = FaceState::default();
    face.set_health(100, 100);
    assert_eq!(face.expr_now(), Mood::Fresh);

    // Damage trigger -> Wince
    face.on_damage(Some(std::f64::consts::PI * 0.5));
    assert_eq!(face.expr_now(), Mood::Wince);
    assert!(face.pain_t > 0.0);

    // Heal trigger -> Smile (after pain subsides)
    face.pain_t = 0.0;
    face.on_heal();
    assert_eq!(face.expr_now(), Mood::Smile);

    // Special trigger -> Grin (highest priority)
    face.on_special();
    assert_eq!(face.expr_now(), Mood::Grin);

    // Dead overrides special/heal/pain
    face.set_health(0, 100);
    assert_eq!(face.expr_now(), Mood::Dead);
}

#[test]
fn procedural_raster_output_bounds_and_symmetry() {
    let mut face = FaceState::default();
    face.set_health(100, 100);
    face.paint();

    assert_eq!(face.buffer.len(), FACE_PX * FACE_PX);

    // Verify non-empty pixels exist (outline, skin, helm, background)
    let non_transparent = face.buffer.iter().filter(|p| p.a > 0).count();
    assert!(non_transparent > 1000);

    // Background color check at top-left
    assert_eq!(face.buffer[0], pk_gui::palette::c(0));
}

#[test]
fn dead_face_and_contact_sheet_generation() {
    let dead = dead_face();
    assert_eq!(dead.hp, 0);
    assert_eq!(dead.tier_of(), Expr::Dead);

    let sheet = face_contact_sheet();
    assert!(!sheet.is_empty());
    assert_eq!(sheet.len(), (16 + 7 * (FACE_PX + 16)) * (32 + 6 * (FACE_PX + 16)));
}
