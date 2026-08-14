// Parity test for Monster Bestiary Special Behaviors (Golem, Jester, Ghost, Boss King).
// Replicates legacy/src/game/pinball-knight/bestiary.ts, boss.ts

use pk_core::grid::Grid;
use pk_core::monsters::boss_king::{step_boss_king, BossKingAction, BossKingState, KingPhase};
use pk_core::monsters::ghost::{ghost_hover_offset, step_ghost};
use pk_core::monsters::golem::generate_golem_shards;
use pk_core::monsters::jester::JesterDisc;
use pk_core::monsters::separation::apply_monster_separation;
use pk_core::monsters::types::{EnemyKind, LiveMonster};

#[test]
fn golem_shatters_into_radial_shards() {
    let shards = generate_golem_shards(5.0, 5.0);
    assert_eq!(shards.shard_velocities.len(), 5);
    for (vx, vz) in shards.shard_velocities {
        let speed = (vx * vx + vz * vz).sqrt();
        assert!((speed - 7.0).abs() < 1e-4);
    }
}

#[test]
fn jester_disc_bounces_off_spring_pads_with_boost() {
    let mut disc = JesterDisc::new(1, 0.0, 0.0, 1.0, 0.0);
    let initial_speed = (disc.vx * disc.vx + disc.vz * disc.vz).sqrt();

    // Strike spring pad with normal (-1.0, 0.0) and boost speed 12.0
    disc.bounce_spring_pad(-1.0, 0.0, 12.0);

    let boosted_speed = (disc.vx * disc.vx + disc.vz * disc.vz).sqrt();
    assert!(disc.vx < 0.0, "Disc velocity must be reflected along spring normal");
    assert!(boosted_speed >= 12.0, "Disc must gain speed from spring pad");
    assert!(boosted_speed > initial_speed);
}

#[test]
fn ghost_phases_through_walls_and_bobs_in_air() {
    let g = Grid::solid(20, 20); // all walls
    let mut ghost = LiveMonster::new(1, EnemyKind::Ghost, 0.0, 0.0);

    let initial_y = ghost_hover_offset(&ghost);
    assert!(initial_y > 0.0, "Ghost must hover above ground plane");

    // Advance ghost through solid wall grid toward target at (5.0, 5.0)
    for _ in 0..60 {
        step_ghost(&mut ghost, &g, 5.0, 5.0, 1.0 / 60.0);
    }

    assert!(ghost.x > 0.5, "Ghost must move through solid wall grid");
    assert!(ghost.z > 0.5);
}

#[test]
fn boss_king_transitions_phases_and_charges() {
    let g = Grid::solid(25, 25);
    let mut boss = LiveMonster::new(1, EnemyKind::BossKing, 10.0, 10.0);
    let mut state = BossKingState::default();

    assert_eq!(state.phase, KingPhase::Phase1March);

    // Drop HP to 50% -> triggers Phase 2 Flipper Charge
    boss.hp = boss.max_hp * 0.5;
    let _ = step_boss_king(&mut boss, &mut state, &g, 15.0, 10.0, 0.016);
    assert_eq!(state.phase, KingPhase::Phase2FlipperCharge);

    // Drop HP to 20% -> triggers Phase 3 Enraged Ricochet
    boss.hp = boss.max_hp * 0.2;
    let _ = step_boss_king(&mut boss, &mut state, &g, 15.0, 10.0, 0.016);
    assert_eq!(state.phase, KingPhase::Phase3EnragedRicochet);
    assert!(state.enraged);
}

#[test]
fn monster_horde_separation_prevents_overlap() {
    let mut monsters = vec![
        LiveMonster::new(1, EnemyKind::Zombie, 5.0, 5.0),
        LiveMonster::new(2, EnemyKind::Zombie, 5.1, 5.0),
    ];

    let initial_dist = (monsters[1].x - monsters[0].x).abs();

    for _ in 0..10 {
        apply_monster_separation(&mut monsters, 0.016);
    }

    let final_dist = (monsters[1].x - monsters[0].x).abs();
    assert!(final_dist > initial_dist, "Separation forces must push monsters apart");
}
