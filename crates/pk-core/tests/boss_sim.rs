//! Comprehensive test suite for boss.ts reaper king boss mechanics, leash, attacks, and network aux.

use pk_core::boss::*;
use pk_core::state::Player;

#[test]
fn boss_constants_match_oracle_derivation() {
    assert_eq!(REAPER_SCALE, 1.35);
    assert_eq!(BRUTE_R, 0.42);
    assert_eq!(KING_SCALE, 1.35 * 1.55);
    assert_eq!(KING_BODY_R, 0.42 * (1.35 * 1.55) * 0.86);
    assert_eq!(KING_HOME_TILES, 2.5);
    assert_eq!(SLAM_RADIUS, 2.6);
    assert_eq!(BONE_MAX_DIST, 16.0);
}

#[test]
fn boss_lifecycle_spawn_adopt_dispose() {
    let mut boss = Some(spawn_boss((10.0, 20.0), 100));
    assert!(boss_active(boss.as_ref()));

    if let Some(b) = boss.as_mut() {
        adopt_boss(b, 50, 100);
        assert_eq!(b.hp, 50);
        assert_eq!(b.max_hp, 100);
        assert!(boss_active(Some(b)));
    }

    dispose_boss(&mut boss);
    assert!(!boss_active(boss.as_ref()));
}

#[test]
fn boss_engagement_and_leashing() {
    let mut boss = spawn_boss((0.0, 0.0), 100);
    let mut player = Player::default();

    // Far away (> KING_WAKE_TILES = 26) -> not engaged
    player.x = 30.0;
    player.z = 0.0;
    update_boss(&mut boss, &mut player, 0.1);
    assert!(!boss_engaged(&boss));

    // Player enters wake range (<= 26) -> engaged
    player.x = 20.0;
    update_boss(&mut boss, &mut player, 0.1);
    assert!(boss_engaged(&boss));

    // Boss gets pulled past leash (> KING_LEASH_TILES = 34) -> returns home
    boss.x = 36.0;
    update_boss(&mut boss, &mut player, 0.1);
    assert!(!boss_engaged(&boss));
    assert!(boss.returning_home);
}

#[test]
fn boss_bone_barrage_and_tentacle_slam() {
    let mut boss = spawn_boss((0.0, 0.0), 100);
    let mut player = Player::default();
    player.x = 10.0;
    player.z = 0.0;
    player.hp = 100.0;

    // Wake the boss
    update_boss(&mut boss, &mut player, 0.1);
    assert!(boss_engaged(&boss));

    // Advance time until bone projectile is spawned
    while boss.bones.is_empty() {
        update_boss(&mut boss, &mut player, 0.1);
    }
    assert!(!boss.bones.is_empty());

    // Advance time until slam enters Telegraph
    while boss.slam_phase != SlamPhase::Telegraph {
        update_boss(&mut boss, &mut player, 0.1);
    }
    assert_eq!(boss.slam_phase, SlamPhase::Telegraph);

    // Bring player right onto slam spot and advance until telegraph resolves to impact
    player.x = boss.slam_x;
    player.z = boss.slam_z;
    while boss.slam_phase == SlamPhase::Telegraph {
        update_boss(&mut boss, &mut player, 0.1);
    }
    assert_eq!(boss.slam_phase, SlamPhase::Idle);
    assert!(player.mom_speed > 0.0);
}

#[test]
fn boss_network_aux_sync_and_replica_update() {
    let mut host_boss = spawn_boss((5.0, 5.0), 100);
    host_boss.slam_phase = SlamPhase::Telegraph;
    host_boss.slam_x = 7.0;
    host_boss.slam_z = 7.0;

    let aux = boss_net_state(&host_boss).expect("net state must serialize");
    assert_eq!(aux.slam_phase, SlamPhase::Telegraph);
    assert_eq!(aux.slam_x, 7.0);

    let mut client_boss = spawn_boss((5.0, 5.0), 100);
    apply_remote_boss_aux(&mut client_boss, Some(&aux));
    assert_eq!(client_boss.slam_phase, SlamPhase::Telegraph);
    assert_eq!(client_boss.slam_x, 7.0);

    update_boss_replica(&mut client_boss, 0.5);
    assert!(client_boss.orbit_t > 0.0);
}
