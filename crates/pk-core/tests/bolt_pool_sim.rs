// Parity test suite for Thunderbolt Line VFX Pool.
// Replicates legacy/src/game/pinball-knight/fx/pools/bolt-pool.ts

use pk_core::fx::bolt_pool::{
    BoltPool, BOLT_CORE_HEX, BOLT_GLOW_HEX, BOLT_LIFE, BOLT_LINES, BOLT_POINTS,
};

#[test]
fn bolt_pool_initializes_preallocated_strands() {
    let pool = BoltPool::new();
    assert_eq!(pool.strands.len(), BOLT_LINES);
    assert_eq!(pool.active_count(), 0);
}

#[test]
fn spawn_creates_dual_strands_with_endpoint_tapering() {
    let mut pool = BoltPool::new();
    let mut rng_seed = 0.5f32;

    pool.spawn([10.0, 0.0, 5.0], [0.0, 1.0], 20.0, || {
        rng_seed = (rng_seed + 0.1) % 1.0;
        rng_seed
    });

    assert_eq!(pool.active_count(), 2);
    assert_eq!(pool.strands[0].color_hex, BOLT_CORE_HEX);
    assert_eq!(pool.strands[1].color_hex, BOLT_GLOW_HEX);
    assert_eq!(pool.strands[0].points.len(), BOLT_POINTS);

    // Endpoints (k=0 and k=15) have 0 lateral offset due to sin(0) and sin(PI)
    let start_p = pool.strands[0].points[0];
    assert_eq!(start_p[0], 10.0);
    assert_eq!(start_p[2], 5.0);

    let end_p = pool.strands[0].points[BOLT_POINTS - 1];
    assert_eq!(end_p[0], 10.0);
    assert_eq!(end_p[2], 25.0); // 5.0 + 20.0
}

#[test]
fn update_decays_and_deactivates_strands() {
    let mut pool = BoltPool::new();
    pool.spawn([0.0, 0.0, 0.0], [1.0, 0.0], 10.0, || 0.5);
    assert_eq!(pool.active_count(), 2);

    pool.update(0.10, || 0.5);
    assert_eq!(pool.active_count(), 2);
    assert!(pool.strands[0].life < BOLT_LIFE);

    pool.update(0.15, || 0.5); // Total 0.25 > 0.22 -> expired
    assert_eq!(pool.active_count(), 0);
}
