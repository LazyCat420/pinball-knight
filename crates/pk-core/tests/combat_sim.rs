// Parity test suite for Combat and Hit Resolution Engine.
// Replicates legacy/src/game/pinball-knight/entities/combat.ts

use std::collections::HashMap;

use pk_core::combat::*;
use pk_core::constants::*;
use pk_core::economy::forge::{ItemRarity, Weapon, WeaponId};
use pk_core::monsters::types::{EnemyKind, EnemyMode, LiveMonster};
use pk_core::skills::SkillAggregate;

#[test]
fn player_damage_calculation_with_weapon_cards_and_synergies() {
    let mut weapon = Weapon::new(WeaponId::Sword, ItemRarity::Epic);
    weapon.upgrade = 2; // +2 upgrade
    weapon.cards.push("spidersilk".to_string()); // +20% damage
    weapon.cards.push("runnersinew".to_string()); // +35% on momentum

    let agg_skills = SkillAggregate {
        damage_mult: 1.10, // +10% from skill tree
        ..SkillAggregate::default()
    };

    // Low speed (standstill)
    let (dmg_standstill, crit_1) = calculate_player_damage(
        10.0,
        Some(&weapon),
        0.0,
        false,
        0,
        0.0,
        &agg_skills,
        0.5,
    );
    assert!(!crit_1);
    assert!(dmg_standstill > 10.0);

    // High momentum speed (18 u/s) + Rage active
    let (dmg_momentum, _) = calculate_player_damage(
        10.0,
        Some(&weapon),
        18.0,
        false,
        15, // Combo 15 > COMBO_ZONE_CRUISE (8)
        5.0, // Rage active
        &agg_skills,
        0.5,
    );
    assert!(dmg_momentum > dmg_standstill * 2.0);
}

#[test]
fn monster_damage_and_gate_immunities() {
    let mut reaper = LiveMonster::new(1, EnemyKind::Reaper, 0.0, 0.0);

    // Reaper cannot be hurt without force
    let res_reaper = damage_monster(
        &mut reaper,
        20.0,
        1.0,
        0.0,
        2.0,
        false,
        DamageSource::Steel,
        0.0,
        0.0,
        0,
        None,
        false,
    );
    assert!(res_reaper.refused_by_gate);
    assert_eq!(reaper.hp, 999.0);

    // Regular zombie takes damage and dies
    let mut zombie = LiveMonster::new(2, EnemyKind::Zombie, 0.0, 0.0);

    let res_zombie = damage_monster(
        &mut zombie,
        20.0,
        1.0,
        0.0,
        2.0,
        false,
        DamageSource::Steel,
        12.0, // Momentum speed
        0.0,
        0,
        None,
        false,
    );
    assert!(!res_zombie.refused_by_gate);
    assert!(res_zombie.killed);
    assert_eq!(zombie.mode, EnemyMode::Dead);
    assert!(res_zombie.gold_awarded >= GOLD_PER_KILL as i64);
    assert_eq!(res_zombie.xp_awarded, XP_KILL);
}

#[test]
fn player_hurt_armor_absorption_and_stoneskin() {
    let mut px = 0.0;
    let mut pz = 0.0;
    let mut hp = 6;
    let mut iframes = 0.0;
    let mut flash_t = 0.0;
    let mut gear = HashMap::new();
    gear.insert("helmet".to_string(), 3);
    gear.insert("armor".to_string(), 5);

    // Raw damage 4 with Stoneskin (50% reduction -> 2)
    // Absorbed by helmet (3 -> 1), 0 damage to hp
    let res = hurt_player(
        4,
        1.0,
        0.0,
        &mut px,
        &mut pz,
        &mut hp,
        &mut iframes,
        &mut flash_t,
        5.0, // Stoneskin active
        0.0, // No shield potion
        false,
        &mut gear,
        false,
        false,
    );

    assert!(res.is_some());
    let r = res.unwrap();
    assert_eq!(r.damage_taken, 2);
    assert_eq!(r.hp_damage, 0);
    assert_eq!(hp, 6);
    assert_eq!(gear.get("helmet"), Some(&1));
    assert_eq!(iframes, PLAYER_IFRAMES);
    assert!(px < 0.0); // Knocked back away from hit origin (1, 0)
}

#[test]
fn thunderbolt_line_aoe_pierces_foes_in_lane() {
    let mut monsters = vec![
        LiveMonster::new(1, EnemyKind::Zombie, 2.0, 0.0),
        LiveMonster::new(2, EnemyKind::Zombie, 5.0, 0.2), // Within half width (0.5)
        LiveMonster::new(3, EnemyKind::Zombie, 5.0, 2.0), // Outside half width (2.0 > 0.5)
    ];

    let base_hp = monsters[0].hp;

    // Thunderbolt along +X from (0, 0)
    let hits = resolve_thunderbolt(0.0, 0.0, 1.0, 0.0, &mut monsters);
    assert_eq!(hits, 2);
    assert_eq!(monsters[0].hp, base_hp - (CARD_BOLT_DAMAGE as f64));
    assert_eq!(monsters[1].hp, base_hp - (CARD_BOLT_DAMAGE as f64));
    assert_eq!(monsters[2].hp, base_hp); // Unharmed
}
