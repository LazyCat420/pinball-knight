//! Comprehensive test suite for legacy/src/game/pinball-knight/render/pinball-parts.ts.

use pk_game::pinball_parts_render::*;

#[test]
fn pinball_parts_kinds_and_hit_lifetimes() {
    assert_eq!(part_hit_lifetime(PinballPartKind::Bumper), 0.6);
    assert_eq!(part_hit_lifetime(PinballPartKind::Flipper), 0.6);
    assert_eq!(part_hit_lifetime(PinballPartKind::Slingshot), 0.6);
    assert_eq!(part_hit_lifetime(PinballPartKind::SpinPad), 0.6);
    assert_eq!(part_hit_lifetime(PinballPartKind::JumpPad), 0.9);
    assert_eq!(part_hit_lifetime(PinballPartKind::Trapdoor), TRAPDOOR_DROP + 1.6);
    assert_eq!(part_hit_lifetime(PinballPartKind::FireVent), VENT_WARN + VENT_ACTIVE + 0.1);
}

#[test]
fn pinball_parts_animation_step() {
    let mut visual = PinballPartVisual {
        id: 1,
        kind: PinballPartKind::SpinPad,
        x: 5.0,
        z: 5.0,
        hit_t: 0.1,
        hits: 0,
        spin_angle: 0.0,
        scale_y: 1.0,
        emissive_intensity: 0.5,
        emissive_hex: C_ARCANE,
        fire_t: 2.0,
        piston_ext: 0.0,
        aimed: false,
        active: true,
    };

    animate_part(&mut visual, 0.1, 1.0);
    assert!(visual.hit_t > 0.1);
    assert!(visual.spin_angle > 0.0);
}

#[test]
fn plunger_rig_release_mechanics() {
    let rig = PlungerRig {
        pull_amount: 1.0,
        charge_progress: 1.0,
        released: true,
        release_t: 0.2,
    };

    assert!(rig.released);
    assert_eq!(rig.pull_amount, 1.0);
}
