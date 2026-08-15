// Parity test suite for Floor FX ground scars and particle puff bursts.
// Replicates legacy/src/game/pinball-knight/entities/floor-fx.ts and fx/puffs.ts

use pk_core::marble::floor_fx::{
    spawn_floor_fx, step_floor_fx, FloorFxKind, CARD_BURN_TICK, FIRE_PUDDLE_DMG,
    FLOOR_FX_MAX, OIL_IGNITE_LIFE,
};
use pk_core::marble::puffs::{spawn_puff_burst, step_puffs, PuffPool};
use pk_core::monsters::types::{EnemyKind, LiveMonster};

#[test]
fn water_slick_applies_slip_to_monsters() {
    let mut fx_list = Vec::new();
    let mut next_id = 0;

    spawn_floor_fx(
        &mut fx_list,
        &mut next_id,
        FloorFxKind::Slick,
        0.0,
        0.0,
        2.0,
        5.0,
    );

    let mut monsters = vec![LiveMonster::new(
        1,
        EnemyKind::Zombie,
        0.5,
        0.5,
    )];

    let impacts = step_floor_fx(&mut fx_list, &mut monsters, 0.016);
    assert_eq!(impacts.len(), 1);
    assert!(impacts[0].applied_slip);
    assert!((monsters[0].vx.abs() > 0.0) || (monsters[0].vz.abs() > 0.0));
}

#[test]
fn fire_puddle_deals_periodic_damage() {
    let mut fx_list = Vec::new();
    let mut next_id = 0;

    spawn_floor_fx(
        &mut fx_list,
        &mut next_id,
        FloorFxKind::Fire,
        0.0,
        0.0,
        2.0,
        5.0,
    );

    let mut monsters = vec![LiveMonster::new(
        1,
        EnemyKind::Zombie,
        0.0,
        0.0,
    )];

    let initial_hp = monsters[0].hp;

    // Advance by burn tick interval
    let impacts = step_floor_fx(&mut fx_list, &mut monsters, CARD_BURN_TICK);
    assert_eq!(impacts.len(), 1);
    assert_eq!(impacts[0].damage, FIRE_PUDDLE_DMG);
    assert_eq!(monsters[0].hp, initial_hp - FIRE_PUDDLE_DMG);
}

#[test]
fn oil_pool_ignites_when_overlapping_fire() {
    let mut fx_list = Vec::new();
    let mut next_id = 0;

    // Spawn Oil at (0, 0)
    spawn_floor_fx(
        &mut fx_list,
        &mut next_id,
        FloorFxKind::Oil,
        0.0,
        0.0,
        1.5,
        10.0,
    );

    // Spawn Fire at (1.0, 0.0) -> overlaps oil
    spawn_floor_fx(
        &mut fx_list,
        &mut next_id,
        FloorFxKind::Fire,
        1.0,
        0.0,
        1.5,
        5.0,
    );

    let mut empty_monsters = vec![];
    step_floor_fx(&mut fx_list, &mut empty_monsters, 0.016);

    // Oil pool should have transformed into Fire with OIL_IGNITE_LIFE
    assert_eq!(fx_list[0].kind, FloorFxKind::Fire);
    assert_eq!(fx_list[0].max_life, OIL_IGNITE_LIFE);
}

#[test]
fn floor_fx_pool_respects_max_capacity() {
    let mut fx_list = Vec::new();
    let mut next_id = 0;

    for i in 0..FLOOR_FX_MAX + 10 {
        spawn_floor_fx(
            &mut fx_list,
            &mut next_id,
            FloorFxKind::Tar,
            i as f64,
            0.0,
            1.0,
            10.0,
        );
    }

    assert_eq!(fx_list.len(), FLOOR_FX_MAX);
}

#[test]
fn puffs_burst_spreads_and_decays() {
    let mut pool = PuffPool::default();

    spawn_puff_burst(&mut pool, 0.0, 0.0, 16, 8.0, 1.0, 0.5);
    assert_eq!(pool.particles.len(), 16);

    // Step by 0.1s
    step_puffs(&mut pool, 0.1);
    assert_eq!(pool.particles.len(), 16);
    // Particles have moved radially outward from (0, 0)
    let p0 = &pool.particles[0];
    assert!((p0.x * p0.x + p0.z * p0.z).sqrt() > 0.1);

    // Step beyond max life -> all particles decay
    step_puffs(&mut pool, 1.0);
    assert!(pool.particles.is_empty());
}
