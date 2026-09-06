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

#[test]
fn exposed_skull_features_at_death() {
    let dead = dead_face();
    let n = 36;
    let s = FACE_PX / n;

    // Check right eye orbital socket void at y: 14..16, x: 21..23
    let mut socket_void = 0;
    for y in 14..=16 {
        for x in 21..=23 {
            let p = dead.buffer[(y * s * FACE_PX + x * s) as usize];
            if p == pk_gui::palette::c(0) || p == pk_gui::palette::c(1) {
                socket_void += 1;
            }
        }
    }
    assert_eq!(socket_void, 9, "Expected 3x3 hollow orbital void in right eye");

    // Check supraorbital bone brow ridge at row 12, x: 21..23
    let mut brow_bone = 0;
    for x in 21..=23 {
        let p = dead.buffer[(12 * s * FACE_PX + x * s) as usize];
        if p == pk_gui::palette::c(4) || p == pk_gui::palette::c(5) {
            brow_bone += 1;
        }
    }
    assert_eq!(brow_bone, 3, "Expected 3 supraorbital bone cells");

    // Check exposed cranium dome under shattered helmet (y: 2..6, x: 21..24)
    let mut cranium_bone = 0;
    for y in 2..=6 {
        for x in 21..=24 {
            let p = dead.buffer[(y * s * FACE_PX + x * s) as usize];
            if p == pk_gui::palette::c(2) || p == pk_gui::palette::c(3) || p == pk_gui::palette::c(4) || p == pk_gui::palette::c(5) {
                cranium_bone += 1;
            }
        }
    }
    assert!(cranium_bone >= 10, "Expected exposed cranium bone under helmet");
}

#[test]
fn conjugated_parallel_gaze_doom_style() {
    let mut face = FaceState::default();
    face.set_health(100, 100);
    // Damage from the right (angle 0) -> glances right (turn = 1)
    face.on_damage(Some(0.0));
    // Advance past pain recoil (0.32s) but within turn hold (0.55s)
    face.render(0.35);

    let n = 36;
    let s = FACE_PX / n;
    let is_iris = |p: pk_gui::Rgba| {
        p == pk_gui::palette::c(29) || p == pk_gui::palette::c(30) || p == pk_gui::palette::c(1) || p == pk_gui::palette::c(18)
    };

    let left_iris_sample = face.buffer[(15 * s * FACE_PX + 15 * s) as usize];
    let right_iris_sample = face.buffer[(15 * s * FACE_PX + 25 * s) as usize];
    let right_sclera_inner = face.buffer[(15 * s * FACE_PX + 22 * s) as usize];

    assert!(is_iris(left_iris_sample), "Left eye iris should shift rightward");
    assert!(is_iris(right_iris_sample), "Right eye iris should shift rightward");
    assert_eq!(right_sclera_inner, pk_gui::palette::c(22), "Inner cell of right eye should be sclera white, not cross-eyed iris");
}
