// Parity test suite for Floor Rune Sigil Effect Pool.
// Replicates legacy/src/game/pinball-knight/fx/pools/sigil-pool.ts

use pk_core::fx::sigil_pool::{SigilPool, SIGIL_COUNT};

#[test]
fn sigil_pool_spawns_and_tracks_lifespan() {
    let mut pool = SigilPool::new();
    assert_eq!(pool.active_count(), 0);

    pool.spawn(10.0, 20.0, 2.5, 0x00ffff, 2.0);
    assert_eq!(pool.active_count(), 1);

    let sigil = &pool.sigils[0];
    assert!(sigil.active);
    assert_eq!(sigil.alpha, 1.0);
    assert_eq!(sigil.color_hex, 0x00ffff);

    // Tick 1.0s (50% elapsed) -> still full alpha
    pool.tick(1.0);
    assert_eq!(pool.active_count(), 1);
    assert_eq!(pool.sigils[0].alpha, 1.0);

    // Tick 0.8s (90% elapsed) -> inside 30% fadeout window
    pool.tick(0.8);
    assert_eq!(pool.active_count(), 1);
    assert!(pool.sigils[0].alpha < 1.0 && pool.sigils[0].alpha > 0.0);

    // Tick 0.3s (fully expired)
    pool.tick(0.3);
    assert_eq!(pool.active_count(), 0);
}

#[test]
fn sigil_pool_recycles_ring_buffer_slots() {
    let mut pool = SigilPool::new();
    for i in 0..12 {
        pool.spawn(i as f64, 0.0, 1.0, 0xffffff, 5.0);
    }
    // Capped at SIGIL_COUNT capacity (8)
    assert_eq!(pool.active_count(), SIGIL_COUNT);
    // Last spawned was slot 3 (12 % 8 = 4 next_idx)
    assert_eq!(pool.next_idx, 4);
}
