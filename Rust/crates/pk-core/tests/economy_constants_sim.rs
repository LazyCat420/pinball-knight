// Parity test suite for Economy & Pickup Physics Constants.
// Replicates legacy/src/game/pinball-knight/constants/economy.ts

use pk_core::constants::economy::*;

#[test]
fn rolling_cart_merchant_constants_match_oracle() {
    assert_eq!(MERCHANT_FROM_LEVEL, 2);
    assert_eq!(MERCHANT_SPEED, 2.2);
    assert_eq!(MERCHANT_FLEE_SPEED, 4.6);
    assert_eq!(MERCHANT_FLEE_RANGE, 4.0);
    assert_eq!(MERCHANT_CATCH_RANGE, 0.7);
    assert_eq!(MERCHANT_BOUNCE_DWELL, 0.45);
    assert_eq!(MERCHANT_BELL_PERIOD, 3.5);
    assert_eq!(MERCHANT_BELL_RANGE, 26.0);
    assert_eq!(MERCHANT_SPAWN_MIN_RING, 5);
}

#[test]
fn coin_drop_burst_and_magnetic_homing_physics_constants() {
    assert_eq!(COIN_MAGNET_RANGE, 2.6);
    assert_eq!(COIN_AURA_RANGE_MULT, 3.0);
    assert_eq!(COIN_MAGNET_TIME, 0.42);
    assert_eq!(COIN_CHEST_Y, 0.62);
    assert_eq!(COIN_MAGNET_ARC, 0.34);
    assert_eq!(COIN_BURST_VY, 2.4);
    assert_eq!(COIN_GRAVITY, 13.0);
    assert_eq!(COIN_BOUNCE, 0.42);
    assert_eq!(COIN_BURST_SPREAD, 1.25);
    assert_eq!(COIN_BURST_DRAG, 3.2);
    assert_eq!(COIN_SETTLE_VY, 0.5);
}
