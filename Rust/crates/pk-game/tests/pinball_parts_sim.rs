// Parity simulation test suite for Pinball Part Meshes & Furniture Subsystem.
// Replicates legacy/src/game/pinball-knight/render/pinball-parts.ts

use pk_game::pinball_parts::*;

#[test]
fn all_23_pinball_part_visual_kinds_build_valid_meshes() {
    let all_kinds = [
        PinballPartKind::Bumper,
        PinballPartKind::Spring,
        PinballPartKind::Ramp,
        PinballPartKind::Booster,
        PinballPartKind::BoostCorner,
        PinballPartKind::BoostCurve,
        PinballPartKind::JumpPad,
        PinballPartKind::Deflector,
        PinballPartKind::Slingshot,
        PinballPartKind::Spinner,
        PinballPartKind::Flipper,
        PinballPartKind::Rollover,
        PinballPartKind::DropTarget,
        PinballPartKind::Plunger,
        PinballPartKind::Magnet,
        PinballPartKind::WarpPortal,
        PinballPartKind::Spikes,
        PinballPartKind::FireVent,
        PinballPartKind::ToxicDrain,
        PinballPartKind::ElectricGate,
        PinballPartKind::Glove,
        PinballPartKind::Gravepit,
        PinballPartKind::Bell,
        PinballPartKind::Chute,
        PinballPartKind::Orbit,
        PinballPartKind::Saucer,
        PinballPartKind::Turret,
        PinballPartKind::SeeSaw,
        PinballPartKind::Catapult,
        PinballPartKind::Cannon,
    ];

    for kind in all_kinds {
        let group = build_part_visual(kind, (1.0, 0.0));
        assert!(!group.submeshes.is_empty(), "Part {:?} has at least one submesh", kind);
        for sub in &group.submeshes {
            assert!(sub.scale[0] > 0.0 && sub.scale[1] > 0.0 && sub.scale[2] > 0.0);
        }
    }
}

#[test]
fn seesaw_mesh_construction_and_tags() {
    let seesaw = build_seesaw(1.0, 0.0);
    assert_eq!(seesaw.kind, PinballPartKind::SeeSaw);
    assert!(seesaw.user_tags.contains_key("fulcrum"));
    assert!(seesaw.user_tags.contains_key("plank"));
}

#[test]
fn catapult_mesh_construction_and_tags() {
    let catapult = build_catapult(1.0, 0.0);
    assert_eq!(catapult.kind, PinballPartKind::Catapult);
    assert!(catapult.user_tags.contains_key("base"));
    assert!(catapult.user_tags.contains_key("arm"));
    assert!(catapult.user_tags.contains_key("basket"));
    assert!(catapult.user_tags.contains_key("weight"));
    assert!(catapult.user_tags.contains_key("trigger"));
}

#[test]
fn cannon_mesh_construction_and_tags() {
    let cannon = build_cannon(1.0, 0.0);
    assert_eq!(cannon.kind, PinballPartKind::Cannon);
    assert!(cannon.user_tags.contains_key("turntable"));
    assert!(cannon.user_tags.contains_key("swivel"));
    assert!(cannon.user_tags.contains_key("barrel"));
    assert!(cannon.user_tags.contains_key("rim"));
}

#[test]
fn bumper_mesh_construction_and_tags() {
    let bumper = build_bumper();
    assert_eq!(bumper.kind, PinballPartKind::Bumper);
    assert_eq!(bumper.submeshes.len(), 3);
    assert!(bumper.user_tags.contains_key("base"));
    assert!(bumper.user_tags.contains_key("ring"));
    assert!(bumper.user_tags.contains_key("dome"));

    let dome_idx = bumper.user_tags["dome"];
    let dome_mat = &bumper.submeshes[dome_idx].material;
    assert_eq!(dome_mat.color, C_ARCANE);
    assert!(!dome_mat.shared, "Dome material is animated and must be unshared");
}

#[test]
fn spring_and_ramp_yaw_and_chevrons() {
    let spring = build_spring(0.0, 1.0);
    assert_eq!(spring.kind, PinballPartKind::Spring);
    assert!(spring.user_tags.contains_key("plate"));
    assert!(spring.user_tags.contains_key("chevron"));

    let ramp = build_ramp(1.0, 0.0);
    assert_eq!(ramp.kind, PinballPartKind::Ramp);
    assert!(ramp.user_tags.contains_key("wedge"));
    assert!(ramp.user_tags.contains_key("lip"));
}

#[test]
fn part_animation_tick_and_hit_punch_decay() {
    let mut part = PartAnimationState::new(PinballPartKind::Bumper, 10.0, 10.0);
    assert_eq!(part.scale_punch, 1.0);
    assert_eq!(part.hit_t, 0.0);

    // Trigger hit punch
    part.trigger_hit();
    assert_eq!(part.hit_t, 0.25);
    assert_eq!(part.scale_punch, 1.35);

    // Step 0.1s
    part.tick(0.1);
    assert!(part.hit_t < 0.25 && part.hit_t > 0.0);
    assert!(part.scale_punch > 1.0 && part.scale_punch < 1.35);

    // Step 0.2s (complete decay)
    part.tick(0.2);
    assert_eq!(part.hit_t, 0.0);
    assert_eq!(part.scale_punch, 1.0);
}

#[test]
fn pinball_parts_camera_range_culling() {
    let mut parts = vec![
        PartAnimationState::new(PinballPartKind::Bumper, 5.0, 5.0),
        PartAnimationState::new(PinballPartKind::Spring, 100.0, 100.0),
    ];

    // Camera at (0,0): first part is within 15 units (range sq 225), second is outside
    update_pinball_parts(&mut parts, 0.1, (0.0, 0.0));
    assert!(parts[0].phase > 0.0, "Near part ticked");
    assert_eq!(parts[1].phase, 0.0, "Far part culled from ticking");
}
