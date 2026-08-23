// Parity test suite for Player Continuous Locomotion.
// Replicates legacy/src/game/pinball-knight/entities/player.ts

use pk_core::entities::player::PlayerLocomotionState;

#[test]
fn player_locomotion_movement_and_sprint() {
    let mut player = PlayerLocomotionState::new(0.0, 0.0);

    // Step north
    player.step((0.0, 1.0), 1.0 / 60.0);
    assert!(player.pos.1 > 0.0);
    assert_eq!(player.facing, (0.0, 1.0));

    // Enable sprint
    player.is_sprinting = true;
    let initial_sprint = player.sprint_meter;
    player.step((0.0, 1.0), 1.0);
    assert!(player.sprint_meter < initial_sprint);

    // Stop moving: sprint meter should regenerate
    player.step((0.0, 0.0), 1.0);
    assert!(player.sprint_meter > 0.0);
}

#[test]
fn player_melee_and_ranged_actions() {
    let mut player = PlayerLocomotionState::new(10.0, 10.0);

    assert_eq!(player.attack_frame, 0);
    assert!(player.trigger_melee());
    assert_eq!(player.attack_frame, 1);

    // Cannot re-trigger mid swing
    assert!(!player.trigger_melee());

    // Step 3 frames to complete swing
    for _ in 0..3 {
        player.step((0.0, 0.0), 1.0 / 60.0);
    }
    assert_eq!(player.attack_frame, 0);

    // Ranged shot muzzle offset
    player.facing = (1.0, 0.0);
    let (muzzle_x, muzzle_z) = player.trigger_ranged();
    assert!(muzzle_x > 10.0);
    assert_eq!(muzzle_z, 10.0);
}
