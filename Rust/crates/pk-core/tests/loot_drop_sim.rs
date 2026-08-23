// Parity test for Monster Loot Tables, Chest Tiers, and Segment Pickup Sweeps.
// Replicates legacy/src/game/pinball-knight/economy/loot.ts, economy/pickups.ts, pickup-sweep.test.ts

use pk_core::economy::loot::{roll_chest_loot, roll_monster_loot, ChestTier};
use pk_core::economy::pickups::segment_distance;
use pk_core::reagents::ReagentId;
use pk_core::rng::Mulberry32;

#[test]
fn boss_drops_heavy_gold_ember_and_boss_card() {
    let mut rng = Mulberry32::new(42);
    let loot = roll_monster_loot("boss_king", 1, true, &mut rng);

    assert!(loot.gold >= 150, "Boss must drop substantial gold");
    assert_eq!(loot.reagent, Some(ReagentId::Grimbone));
    assert_eq!(loot.card_id, Some("boss_king".to_string()));
}

#[test]
fn standard_monster_loot_matches_family_reagents() {
    let mut rng = Mulberry32::new(12345);

    // Roll 50 slime kills - expect some Slimegel
    let mut dropped_slimegel = false;
    for _ in 0..50 {
        let loot = roll_monster_loot("slime", 1, false, &mut rng);
        if loot.reagent == Some(ReagentId::Slimegel) {
            dropped_slimegel = true;
            break;
        }
    }
    assert!(dropped_slimegel, "Slimes must drop Slimegel");
}

#[test]
fn chest_tiers_scale_rewards() {
    let mut rng = Mulberry32::new(777);

    let wood = roll_chest_loot(ChestTier::Wood, 1, &mut rng);
    let iron = roll_chest_loot(ChestTier::Iron, 1, &mut rng);
    let gold = roll_chest_loot(ChestTier::Gold, 1, &mut rng);

    assert!(gold.gold > iron.gold);
    assert!(iron.gold > wood.gold);
    assert!(gold.potion.is_some());
    assert!(gold.weapon.is_some());
}

#[test]
fn segment_distance_accurately_measures_perpendicular_distance() {
    // Movement segment from (0, 0) to (10, 0)
    // Point sits at (5, 2)
    let dist = segment_distance(0.0, 0.0, 10.0, 0.0, 5.0, 2.0);
    assert!((dist - 2.0).abs() < 1e-6);

    // Point before start segment at (-3, 0)
    let dist_before = segment_distance(0.0, 0.0, 10.0, 0.0, -3.0, 0.0);
    assert!((dist_before - 3.0).abs() < 1e-6);

    // Point after end segment at (14, 0)
    let dist_after = segment_distance(0.0, 0.0, 10.0, 0.0, 14.0, 0.0);
    assert!((dist_after - 4.0).abs() < 1e-6);
}
