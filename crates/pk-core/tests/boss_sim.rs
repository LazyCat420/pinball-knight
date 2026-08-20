// Parity test for The Reaper King Boss System.
// Replicates legacy/src/game/pinball-knight/boss.ts

use pk_core::boss::{
    boss_active, boss_engaged, spawn_boss, BossEvent, SKULL_COUNT, SLAM_DAMAGE, SLAM_LAUNCH,
};

#[test]
fn boss_initialization_and_orbit_wheel() {
    let mut boss = spawn_boss(10.0, 10.0, 100);
    assert_eq!(boss.hp, 100);
    assert_eq!(boss.max_hp, 100);
    assert_eq!(boss.skulls.len(), SKULL_COUNT);
    assert!(boss_active(Some(&boss)));
    assert!(!boss_engaged(Some(&boss)));

    // Tick orbit
    let initial_x = boss.skulls[0].x;
    boss.update(0.1, (50.0, 50.0), true, Some(40.0), None);
    assert_ne!(boss.skulls[0].x, initial_x);
}

#[test]
fn boss_leash_and_wake_mechanics() {
    let mut boss = spawn_boss(10.0, 10.0, 100);

    // Player far away (path distance 30 > WAKE 26): boss stays unengaged
    let events = boss.update(0.1, (40.0, 40.0), true, Some(30.0), None);
    assert!(!boss.engaged);
    assert!(!events.iter().any(|e| matches!(e, BossEvent::KingStirsToast)));

    // Player steps within wake distance (path distance 20 <= WAKE 26) while visible
    let events = boss.update(0.1, (20.0, 20.0), true, Some(20.0), None);
    assert!(boss.engaged);
    assert!(boss.aggro);
    assert!(events.iter().any(|e| matches!(e, BossEvent::KingStirsToast)));

    // Boss gets lured far past leash distance (world dist > LEASH 34)
    boss.x = 60.0;
    boss.z = 60.0;
    let _ = boss.update(0.1, (65.0, 65.0), true, Some(5.0), None);
    assert!(!boss.engaged);
    assert!(!boss.aggro);

    // Disengaged boss steps back toward anchor when player retreats
    let old_x = boss.x;
    let _ = boss.update(0.5, (65.0, 65.0), true, Some(40.0), None);
    assert!(boss.x < old_x, "Boss should walk home toward anchor");
}

#[test]
fn boss_slam_telegraph_and_impact() {
    let mut boss = spawn_boss(10.0, 10.0, 100);
    boss.engaged = true;

    // Fast-forward to telegraph start (slam_t <= 1.1)
    boss.slam_t = 1.15;
    let events = boss.update(0.1, (12.0, 10.0), true, Some(2.0), None);
    assert!(events.iter().any(|e| matches!(e, BossEvent::SlamTelegraphed { .. })));
    assert!(boss.telegraph.is_some());

    // Fast-forward to impact
    boss.slam_t = 0.05;
    let events = boss.update(0.1, (12.0, 10.0), true, Some(2.0), None);
    assert!(events.iter().any(|e| matches!(e, BossEvent::SlamImpact { .. })));

    // Player was at (12.0, 10.0) which is 2.0 tiles from slam (within SLAM_RADIUS 2.6)
    let hit_event = events.iter().find(|e| matches!(e, BossEvent::PlayerHitSlam { .. }));
    assert!(hit_event.is_some());
    if let Some(BossEvent::PlayerHitSlam { damage, launch_speed, .. }) = hit_event {
        assert_eq!(*damage, SLAM_DAMAGE);
        assert_eq!(*launch_speed, SLAM_LAUNCH);
    }
}

#[test]
fn boss_bone_barrage_and_projectile_travel() {
    let mut boss = spawn_boss(10.0, 10.0, 100);
    boss.engaged = true;
    boss.barrage_t = 0.01;

    // Firing bone at player at (15.0, 10.0)
    let events = boss.update(0.02, (15.0, 10.0), true, Some(5.0), None);
    assert!(events.iter().any(|e| matches!(e, BossEvent::BoneFired { .. })));
    assert_eq!(boss.bones.len(), 1);

    // Step bone until collision with player
    let mut hit = false;
    for _ in 0..20 {
        let evts = boss.update(0.05, (15.0, 10.0), true, Some(5.0), None);
        if evts.iter().any(|e| matches!(e, BossEvent::PlayerHitRanged { .. })) {
            hit = true;
            break;
        }
    }
    assert!(hit, "Bone projectile should collide with player");
}

#[test]
fn boss_death_opens_exit_portal() {
    let mut boss = spawn_boss(10.0, 10.0, 100);
    assert!(!boss.opened);
    assert!(boss.portal.is_none());

    // Slay the king
    boss.hp = 0;
    let events = boss.update(0.1, (10.0, 10.0), true, Some(0.0), None);
    assert!(boss.opened);
    assert!(boss.portal.is_some());
    assert!(boss.skulls.is_empty());
    assert!(!boss_active(Some(&boss)));
    assert!(events.iter().any(|e| matches!(e, BossEvent::PortalOpened { .. })));
}

#[test]
fn boss_fairness_scaling_scales_hp_proportionally() {
    let mut boss = spawn_boss(10.0, 10.0, 100);
    assert_eq!(boss.scaled_for, 1);
    assert_eq!(boss.hp, 100);

    // Deal 50 damage (50% remaining)
    boss.hp = 50;

    // 2 players join floor
    let rescaled = boss.scale_for_knights(2);
    assert!(rescaled);
    assert_eq!(boss.scaled_for, 2);
    assert_eq!(boss.max_hp, 200);
    assert_eq!(boss.hp, 100); // exactly 50% preserved!
}
