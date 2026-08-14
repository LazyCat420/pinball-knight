// Parity test for Coin Minting, Zero-Drift Value Splitting, and Magnet Physics.
// Replicates legacy/src/game/pinball-knight/economy/coins.ts, coins.test.ts

use pk_core::economy::coins::{
    coin_count_for, split_coin_value, update_coins_physics, CoinEntity,
    COIN_LIVE_CAP, COIN_MAGNET_RANGE, COIN_MAX_PER_DROP,
};

#[test]
fn split_coin_value_sums_to_exact_total_with_zero_drift() {
    for total in [1, 2, 7, 10, 13, 25, 100, 247, 1000] {
        for n in 1..=COIN_MAX_PER_DROP {
            let coins = split_coin_value(total, n);
            assert_eq!(coins.len(), n);
            let sum: i64 = coins.iter().sum();
            assert_eq!(
                sum, total,
                "split of total {total} across {n} coins drifted to {sum}"
            );
        }
    }
}

#[test]
fn coin_count_for_clamps_between_one_and_max_drop() {
    assert_eq!(coin_count_for(1), 1);
    assert_eq!(coin_count_for(5), 5);
    assert_eq!(coin_count_for(12), 12);
    assert_eq!(coin_count_for(100), COIN_MAX_PER_DROP);
    assert_eq!(coin_count_for(0), 0);
}

#[test]
fn coin_magnet_pulls_and_credits_within_pickup_range() {
    let mut coins = vec![
        CoinEntity::new(1, 1.0, 1.0, 10, 0.0, 0.0),
        CoinEntity::new(2, 8.0, 8.0, 25, 0.0, 0.0),
    ];

    // Player stands right next to coin 1
    let credited = update_coins_physics(&mut coins, 1.05, 1.05, false, 0.016);
    assert_eq!(credited, 10, "Coin 1 should be immediately collected");
    assert_eq!(coins.len(), 1, "Only coin 2 remains");

    // Coin 2 is far away (at 8.0, 8.0), player is at (1.05, 1.05)
    let credited2 = update_coins_physics(&mut coins, 1.05, 1.05, false, 0.016);
    assert_eq!(credited2, 0, "Distant coin is not collected");
    assert_eq!(coins.len(), 1);
}

#[test]
fn sprint_aura_doubles_magnetic_pull_range() {
    let mut coins = vec![
        CoinEntity::new(1, 3.5, 0.0, 50, 0.0, 0.0),
    ];

    // Distance is 3.5 units. Normal magnet is 2.2 units (does not reach).
    update_coins_physics(&mut coins, 0.0, 0.0, false, 0.016);
    assert_eq!(coins[0].vx, 0.0, "Normal magnet does not reach at 3.5 units");

    // Sprint aura magnet reaches 2.2 * 2.0 = 4.4 units!
    update_coins_physics(&mut coins, 0.0, 0.0, true, 0.016);
    assert!(coins[0].vx < 0.0, "Sprint aura pulls coin towards x=0");
}
