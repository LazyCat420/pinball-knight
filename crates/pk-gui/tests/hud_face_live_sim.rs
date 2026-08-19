use pk_gui::hud_face::*;

#[test]
fn test_hud_face_directional_damage_reaction() {
    let mut face = FaceState::default();
    face.set_health(6, 6);
    assert_eq!(face.tier_of(), Expr::Fresh);
    assert_eq!(face.helmet_stage_of(), 0);

    // Damage from right (angle 0)
    face.on_damage(Some(0.0));
    assert_eq!(face.expr_now(), Mood::Wince);
    assert_eq!(face.turn, 1); // Turns right
    assert!(face.look_x > 0.5);

    // Damage from left (angle PI)
    face.on_damage(Some(std::f64::consts::PI));
    assert_eq!(face.turn, -1); // Turns left
    assert!(face.look_x < -0.5);
}

#[test]
fn test_hud_face_health_degradation_stages() {
    let mut face = FaceState::default();

    // 6/6 HP (100%) -> Fresh (Stage 0)
    face.set_health(6, 6);
    assert_eq!(face.tier_of(), Expr::Fresh);
    assert_eq!(face.helmet_stage_of(), 0);

    // 4/6 HP (66.7%) -> Steady (Stage 1)
    face.set_health(4, 6);
    assert_eq!(face.tier_of(), Expr::Steady);
    assert_eq!(face.helmet_stage_of(), 1);

    // 3/6 HP (50%) -> Hurt (Stage 2)
    face.set_health(3, 6);
    assert_eq!(face.tier_of(), Expr::Hurt);
    assert_eq!(face.helmet_stage_of(), 2);

    // 2/6 HP (33.3%) -> Bloodied (Stage 3)
    face.set_health(2, 6);
    assert_eq!(face.tier_of(), Expr::Bloodied);
    assert_eq!(face.helmet_stage_of(), 3);

    // 1/6 HP (16.7%) -> Dying (Stage 4)
    face.set_health(1, 6);
    assert_eq!(face.tier_of(), Expr::Dying);
    assert_eq!(face.helmet_stage_of(), 4);

    // 0/6 HP (0%) -> Dead (Stage 5)
    face.set_health(0, 6);
    assert_eq!(face.tier_of(), Expr::Dead);
    assert_eq!(face.helmet_stage_of(), 5);
}

#[test]
fn test_hud_face_idle_scan_and_blinking() {
    let mut face = FaceState::default();
    face.set_health(6, 6);

    // Advance 3.0 seconds (180 frames @ 60fps) of idle frames
    let mut glanced = false;
    for _ in 0..180 {
        face.render(1.0 / 60.0);
        if face.turn != 0 {
            glanced = true;
        }
    }
    assert!(glanced, "Face should perform idle glances across frames");
}
