// Parity test suite for Shockwave Ring Pool.
// Replicates legacy/src/game/pinball-knight/fx/pools/ring-pool.ts

use pk_core::fx::ring_pool::{RingOpts, RingPool, RING_COUNT, RING_INNER, RING_INNER_THIN};

#[test]
fn ring_pool_spawns_and_animates_expanding_shockwave() {
    let mut pool = RingPool::new();
    assert_eq!(pool.active_count(), 0);

    pool.spawn(
        5.0,
        10.0,
        4.0,
        1.0,
        Some(RingOpts {
            delay: 0.0,
            inward: false,
            thin: false,
            opacity: 0.8,
        }),
    );

    assert_eq!(pool.active_count(), 1);
    let slot = pool.slots[0];
    assert_eq!(slot.x, 5.0);
    assert_eq!(slot.z, 10.0);
    assert_eq!(slot.current_r, 0.0);

    // Step halfway (t = 0.5 -> ease-out gives 75% radius = 3.0)
    pool.step(0.5);
    let slot = pool.slots[0];
    assert!(slot.active);
    assert!((slot.current_r - 3.0).abs() < 0.1);
    assert!(slot.current_opacity > 0.0);

    // Step to expiration
    pool.step(0.6);
    assert_eq!(pool.active_count(), 0);
}

#[test]
fn ring_pool_inward_collapse_and_delay() {
    let mut pool = RingPool::new();

    pool.spawn(
        0.0,
        0.0,
        5.0,
        1.0,
        Some(RingOpts {
            delay: 0.5,
            inward: true,
            thin: true,
            opacity: 1.0,
        }),
    );

    // During delay, opacity is 0 and radius is max
    pool.step(0.2);
    assert_eq!(pool.slots[0].current_opacity, 0.0);
    assert_eq!(pool.slots[0].current_r, 5.0);

    // Consume remaining delay
    pool.step(0.3);

    // Active collapse step
    pool.step(0.3);
    assert!(pool.slots[0].current_r < 5.0);
    assert!(pool.slots[0].current_opacity > 0.0);
}

#[test]
fn ring_geometry_radii_constants() {
    assert_eq!(RING_COUNT, 16);
    assert!((RING_INNER - 0.78).abs() < 1e-4);
    assert!((RING_INNER_THIN - 0.955).abs() < 1e-4);
}
