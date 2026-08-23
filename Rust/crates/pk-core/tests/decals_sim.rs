// Parity test suite for Floor Decals and Scorch Stamps.
// Replicates legacy/src/game/pinball-knight/fx/floor/decals.ts

use pk_core::marble::decals::{DecalKind, DecalPool, MAX_DECALS};

#[test]
fn decal_pool_spawns_and_wraps_capacity() {
    let mut pool = DecalPool::new();

    // Spawn 130 decals (exceeding 128 max capacity)
    for i in 0..130 {
        pool.spawn(DecalKind::Blood, i as f64, 0.0, 0.0, 1.0, 10.0);
    }

    assert_eq!(pool.cursor, 2);
    let active_count = pool.active_decals().count();
    assert_eq!(active_count, MAX_DECALS);
}

#[test]
fn decal_step_ages_and_fades_alpha() {
    let mut pool = DecalPool::new();

    pool.spawn(DecalKind::Scorch, 10.0, 10.0, 0.5, 1.2, 10.0);
    let decal = &pool.decals[0];
    assert!(decal.active);
    assert_eq!(decal.alpha, 1.0);

    // Step 8.0s -> 2.0s remaining (under 3.0s fade threshold)
    pool.step(8.0);
    let faded_decal = &pool.decals[0];
    assert!(faded_decal.active);
    assert!((faded_decal.alpha - 0.666).abs() < 0.01);

    // Step additional 3.0s -> expires
    pool.step(3.0);
    let dead_decal = &pool.decals[0];
    assert!(!dead_decal.active);
    assert_eq!(dead_decal.alpha, 0.0);
}
