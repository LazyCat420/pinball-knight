// Comprehensive simulation test suite for Core Physics & Pinball Constants Cluster.
// Replicates legacy/src/game/pinball-knight/constants/pinball.ts, constants/player.ts, constants.ts

use pk_core::constants::pinball::*;
use pk_core::constants::player::*;

#[test]
fn player_kinematics_and_sprint_ratios() {
    assert_eq!(PLAYER_SPEED, 4.2);
    assert_eq!(PLAYER_MAX_HP, 6);
    assert_eq!(SPRINT_BASE_MULT, 1.35);
    assert_eq!(SPRINT_SPEED_MULT, 1.85);

    let max_sprint_speed = PLAYER_SPEED * SPRINT_SPEED_MULT;
    assert!(max_sprint_speed > 7.7);
    assert!(SPRINT_RAMP_TIME > 1.0);
}

#[test]
fn move_scaling_by_weapon_heft() {
    let heavy_weapon_heft = 1.5;
    let scaled_light1 = scale_move(LIGHT_1, heavy_weapon_heft);

    assert_eq!(scaled_light1.tag, MoveTag::Light1);
    assert_eq!(scaled_light1.active, LIGHT_1.active); // active frames never stretch
    assert!((scaled_light1.windup - LIGHT_1.windup * 1.5).abs() < 1e-6);
    assert!((scaled_light1.recovery - LIGHT_1.recovery * 1.5).abs() < 1e-6);
}

#[test]
fn combo_chain_progression() {
    assert_eq!(COMBO_CHAIN.len(), 4);
    assert_eq!(COMBO_CHAIN[0].tag, MoveTag::Light1);
    assert_eq!(COMBO_CHAIN[1].tag, MoveTag::Light2);
    assert_eq!(COMBO_CHAIN[2].tag, MoveTag::Finish);
    assert_eq!(COMBO_CHAIN[3].tag, MoveTag::Surge);

    // Damage multiplies up along the chain
    assert!(COMBO_CHAIN[0].damage_mul < COMBO_CHAIN[1].damage_mul);
    assert!(COMBO_CHAIN[1].damage_mul < COMBO_CHAIN[2].damage_mul);
    assert!(COMBO_CHAIN[2].damage_mul < COMBO_CHAIN[3].damage_mul);
}

#[test]
fn pinball_restitution_and_groove_bounds() {
    assert!(PINBALL_WALL_RESTITUTION < 1.0);
    assert!(PINBALL_CORNER_RESTITUTION > 1.0);
    assert_eq!(PINBALL_MAX_SPEED, 22.0);
    assert_eq!(FLOOR_FX_MAX, 300);
    assert_eq!(MULTIBALL_COUNT, 2);
}
