//! Integration test suite verifying 1:1 parity of the ported tables in `pk-core`
//! (reagents, recipes, zombie_types, bestiary, items, abilities, boss, secrets)
//! against the original game's authored constants.

use pk_core::abilities::{AbilityId, ABILITY_RANK_MAX, ABILITY_RANK_STEP};
use pk_core::bestiary::{info_for_kind, MONSTER_INFOS};
use pk_core::boss::{
    BossKingState, KING_BODY_R, KING_HOME_TILES, KING_LEASH_TILES, KING_RETURN_SPEED,
    KING_SCALE, KING_WAKE_TILES, REAPER_SCALE, SKULL_COUNT, SKULL_ORBIT_R,
    SKULL_ORBIT_SPEED, SLAM_DAMAGE, SLAM_INTERVAL, SLAM_RADIUS, SLAM_TELEGRAPH,
};
use pk_core::items::{
    salvage_value, ItemRarity, WeaponId, WeaponKind, SALVAGE_PER_UPGRADE,
    UPGRADE_DAMAGE_STEP, UPGRADE_DURABILITY_STEP, UPGRADE_RISK_CAP,
    UPGRADE_RISK_STEP, UPGRADE_SAFE_LEVEL,
};
use pk_core::reagents::{drops_for_kind, roll_reagent_drops, ReagentId, ReagentTier};
use pk_core::recipes::{can_craft, Pouch, RecipeId};
use pk_core::secrets::{
    prune_sealed_bands, stamp_secret_bands, TilePos, REVOLVE_SWEEP, REVOLVE_TIME,
};
use pk_core::zombie_types::{
    mix32, pick_zombie_type, type_drop_mult, type_hp, ZombieException, ZombieType,
};

#[test]
fn test_reagents_parity() {
    // 14 reagent IDs
    assert_eq!(ReagentId::ALL.len(), 14);

    // Verify slimegel
    let slimegel = ReagentId::Slimegel.def();
    assert_eq!(slimegel.label, "Slime Gel");
    assert_eq!(slimegel.icon, "🟢");
    assert_eq!(slimegel.tier, ReagentTier::Common);
    assert_eq!(slimegel.color, "#7bd47b");
    assert_eq!(slimegel.description, "jelly from a slime");

    // Verify grimbone
    let grimbone = ReagentId::Grimbone.def();
    assert_eq!(grimbone.label, "Grim Bone");
    assert_eq!(grimbone.icon, "💀");
    assert_eq!(grimbone.tier, ReagentTier::Rare);
    assert_eq!(grimbone.color, "#e8e6df");

    // Verify drops for zombie kind
    let zombie_drops = drops_for_kind("zombie");
    assert_eq!(zombie_drops.len(), 1);
    assert_eq!(zombie_drops[0].id, ReagentId::Rotflesh);
    assert!((zombie_drops[0].chance - 0.28).abs() < 1e-6);

    // Verify drops for spider kind
    let spider_drops = drops_for_kind("spider");
    assert_eq!(spider_drops.len(), 2);
    assert_eq!(spider_drops[0].id, ReagentId::Silk);
    assert!((spider_drops[0].chance - 0.18).abs() < 1e-6);
    assert_eq!(spider_drops[1].id, ReagentId::Fang);
    assert!((spider_drops[1].chance - 0.10).abs() < 1e-6);

    // Verify boss guaranteed grimbone
    let boss_drops = roll_reagent_drops("zombie", true, None, || 0.999);
    assert_eq!(boss_drops, vec![ReagentId::Grimbone]);
}

#[test]
fn test_recipes_parity() {
    // 16 recipe IDs
    assert_eq!(RecipeId::ALL.len(), 16);

    // Verify flask recipe
    let flask = RecipeId::Flask.def();
    assert_eq!(flask.label, "Empty Flask");
    assert_eq!(flask.output, "flask");
    assert_eq!(flask.flasks, 0);
    assert_eq!(flask.gold, 0);
    assert_eq!(flask.inputs, &[(ReagentId::Glass, 3)]);

    // Verify elixir recipe
    let elixir = RecipeId::Elixir.def();
    assert_eq!(elixir.label, "Elixir of Life");
    assert_eq!(elixir.output, "elixir");
    assert_eq!(elixir.flasks, 2);
    assert_eq!(elixir.gold, 40);
    assert_eq!(
        elixir.inputs,
        &[
            (ReagentId::Grimbone, 1),
            (ReagentId::Ectoplasm, 1),
            (ReagentId::Slimegel, 2),
        ]
    );

    // Test can_craft
    let mut pouch = Pouch::new();
    pouch.insert(ReagentId::Grimbone, 1);
    pouch.insert(ReagentId::Ectoplasm, 1);
    pouch.insert(ReagentId::Slimegel, 2);
    assert!(!can_craft(&elixir, &pouch, 1, 40)); // Not enough flasks (needs 2)
    assert!(!can_craft(&elixir, &pouch, 2, 39)); // Not enough gold (needs 40)
    assert!(can_craft(&elixir, &pouch, 2, 40));  // Afforded!
}

#[test]
fn test_zombie_types_parity() {
    assert_eq!(ZombieType::ALL.len(), 8);

    // Weights sum to 100
    let total_weight: u32 = ZombieType::ALL.iter().map(|t| t.def().weight).sum();
    assert_eq!(total_weight, 100);

    // Verify Shambler baseline
    let shambler = ZombieType::Shambler.def();
    assert_eq!(shambler.speed_mult, 1.0);
    assert_eq!(shambler.hp_mult, 1.0);
    assert_eq!(shambler.weight, 34);
    assert_eq!(shambler.from_level, 1);
    assert_eq!(shambler.exception, None);

    // Verify Runner
    let runner = ZombieType::Runner.def();
    assert_eq!(runner.speed_mult, 1.75);
    assert_eq!(runner.hp_mult, 0.67);
    assert_eq!(runner.weight, 16);
    assert_eq!(runner.from_level, 2);
    assert_eq!(runner.movement, Some("flanker"));
    assert_eq!(runner.exception, Some(ZombieException::DodgesRanged));

    // Verify Hulk
    let hulk = ZombieType::Hulk.def();
    assert_eq!(hulk.speed_mult, 0.7);
    assert_eq!(hulk.hp_mult, 3.0);
    assert_eq!(hulk.scale, 1.55);
    assert_eq!(hulk.body_r_mult, 1.5);
    assert_eq!(hulk.knockback, Some(7.5));
    assert_eq!(hulk.exception, Some(ZombieException::SpeedOnly));

    // Verify mix32 & deterministic pick
    assert_eq!(mix32(0), 0);
    let pick1 = pick_zombie_type(12345, 1);
    let pick2 = pick_zombie_type(12345, 1);
    assert_eq!(pick1, pick2);
    assert_eq!(type_hp(3, ZombieType::Hulk), 9);
    assert_eq!(type_drop_mult(ZombieType::Hulk), 2.0); // capped at 2.0
}

#[test]
fn test_bestiary_parity() {
    assert_eq!(MONSTER_INFOS.len(), 28);
    let zombie = info_for_kind("zombie").expect("zombie exists");
    assert_eq!(zombie.label, "Zombie");
    assert_eq!(zombie.icon, "🧟");

    let fish_feet = info_for_kind("fish_feet").expect("fish_feet exists");
    assert_eq!(fish_feet.label, "Fish Feet");
    assert_eq!(fish_feet.icon, "👟");
}

#[test]
fn test_items_weapons_parity() {
    assert_eq!(WeaponId::ALL.len(), 11);

    // Verify fists
    let fists = WeaponId::Fists.def();
    assert_eq!(fists.kind, WeaponKind::Melee);
    assert_eq!(fists.damage, 1);
    assert_eq!(fists.max_durability, u32::MAX);

    // Verify sword
    let sword = WeaponId::Sword.def();
    assert_eq!(sword.damage, 2);
    assert_eq!(sword.max_durability, 30);

    // Verify chair (crowd 360 sweep)
    let chair = WeaponId::Chair.def();
    assert_eq!(chair.arc_cos, 0.0);
    assert_eq!(chair.knockback_mult, 2.2);

    // Verify bow (pierce)
    let bow = WeaponId::Bow.def();
    assert_eq!(bow.kind, WeaponKind::Ranged);
    assert_eq!(bow.projectile, Some("arrow"));
    assert_eq!(bow.pierce, 2);

    // Verify upgrade and salvage constants
    assert_eq!(UPGRADE_SAFE_LEVEL, 3);
    assert_eq!(UPGRADE_RISK_STEP, 0.12);
    assert_eq!(UPGRADE_RISK_CAP, 0.6);
    assert_eq!(UPGRADE_DAMAGE_STEP, 0.12);
    assert_eq!(UPGRADE_DURABILITY_STEP, 0.08);
    assert_eq!(SALVAGE_PER_UPGRADE, 12);

    assert_eq!(salvage_value(ItemRarity::Common, 0), 15);
    assert_eq!(salvage_value(ItemRarity::Rare, 0), 40);
    assert_eq!(salvage_value(ItemRarity::Epic, 0), 90);
    assert_eq!(salvage_value(ItemRarity::Legendary, 0), 200);
    assert_eq!(salvage_value(ItemRarity::Legendary, 3), 200 + 36);
}

#[test]
fn test_abilities_parity() {
    assert_eq!(AbilityId::ALL.len(), 6);
    assert_eq!(ABILITY_RANK_MAX, 5);
    assert_eq!(ABILITY_RANK_STEP, 0.15);

    let fc = AbilityId::Flippercharge.def();
    assert_eq!(fc.cost, 20);
    assert_eq!(fc.cooldown, 3.5);
    assert_eq!(fc.color, "#f0a63c");

    let ap = AbilityId::Arcanepulse.def();
    assert_eq!(ap.cost, 35);
    assert_eq!(ap.cooldown, 5.0);
    assert_eq!(ap.color, "#b06fe8");
}

#[test]
fn test_boss_king_parity() {
    assert_eq!(REAPER_SCALE, 1.35);
    assert!((KING_SCALE - 1.35 * 1.55).abs() < 1e-6);
    assert_eq!(KING_WAKE_TILES, 26.0);
    assert_eq!(KING_LEASH_TILES, 34.0);
    assert_eq!(KING_HOME_TILES, 2.5);
    assert_eq!(KING_RETURN_SPEED, 0.75);

    assert_eq!(SKULL_COUNT, 5);
    assert_eq!(SKULL_ORBIT_R, 1.5);
    assert_eq!(SKULL_ORBIT_SPEED, 1.1);

    assert_eq!(SLAM_INTERVAL, 4.2);
    assert_eq!(SLAM_TELEGRAPH, 1.1);
    assert_eq!(SLAM_RADIUS, 2.4);
    assert_eq!(SLAM_DAMAGE, 3);

    let mut king = BossKingState::new(10.0, 20.0, 1);
    assert_eq!(king.hp, 65);
    king.tick_orbit(1.0);
    assert!((king.skull_angle - 1.1).abs() < 1e-6);
    assert!((king.slam_t - 1.0).abs() < 1e-6);
}

#[test]
fn test_secrets_parity() {
    assert_eq!(REVOLVE_TIME, 0.85);
    assert!((REVOLVE_SWEEP - std::f64::consts::PI * 1.15).abs() < 1e-6);
}
