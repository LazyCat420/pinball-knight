// Parity test suite for Pinball Knight Cards, Socketing, Reader & Foil System.
// Replicates legacy/src/game/pinball-knight/cards.ts and card-reader.ts.

use pk_core::cards::*;
use pk_core::economy::forge::{ItemRarity, Weapon, WeaponId};

#[test]
fn cards_catalogue_has_twenty_five_cards_five_per_rarity() {
    assert_eq!(CARDS.len(), 25);
    for r in [
        CardRarity::Common,
        CardRarity::Rare,
        CardRarity::Epic,
        CardRarity::Legendary,
        CardRarity::Mythic,
    ] {
        let cards = cards_of_rarity(r);
        assert_eq!(cards.len(), 5, "Expected 5 cards for rarity {r:?}");
    }
}

#[test]
fn card_instance_keying_and_parsing_roundtrip() {
    // Canonical level 1 plain collapses to bare base id
    assert_eq!(card_key("spidersilk", 1, false), "spidersilk");
    assert_eq!(card_key("spidersilk", 1, true), "spidersilk#1s");
    assert_eq!(card_key("spidersilk", 4, false), "spidersilk#4");
    assert_eq!(card_key("spidersilk", 4, true), "spidersilk#4s");

    // Level clamping [1..CARD_LEVEL_MAX]
    assert_eq!(card_key("spidersilk", 0, false), "spidersilk");
    assert_eq!(card_key("spidersilk", 99, false), "spidersilk#10");

    // Parsing
    let p1 = parse_card("spidersilk");
    assert_eq!(p1.base, "spidersilk");
    assert_eq!(p1.level, 1);
    assert!(!p1.shiny);

    let p2 = parse_card("spidersilk#4s");
    assert_eq!(p2.base, "spidersilk");
    assert_eq!(p2.level, 4);
    assert!(p2.shiny);

    // Dev tolerance
    let p3 = parse_card("spidersilk#5extra");
    assert_eq!(p3.base, "spidersilk");
    assert_eq!(p3.level, 5);
}

#[test]
fn card_scaling_multiplies_both_upside_and_downside() {
    // Hulk Knuckle base: +60% damage, +15% cooldown (1.6 dmg, 1.15 cd)
    let base_def = card_catalogue("hulkknuckle").unwrap();
    let base_mod = base_def.modifier;

    let growth_lv6 = card_growth(6, false); // 1 + 0.12 * 5 = 1.60
    assert!((growth_lv6 - 1.60).abs() < 1e-6);

    let scaled = scale_modifier(base_mod, growth_lv6);
    // Damage: 1 + (1.6 - 1) * 1.6 = 1.96 (+96% dmg)
    assert!((scaled.damage_mult.unwrap() - 1.96).abs() < 1e-3);
    // Cooldown penalty: 1 + (1.15 - 1) * 1.6 = 1.24 (+24% cd penalty)
    assert!((scaled.cooldown_mult.unwrap() - 1.24).abs() < 1e-3);
}

#[test]
fn card_aggregation_and_soft_capping() {
    // Single card: no diminishing returns
    let c1 = vec!["spidersilk".to_string()]; // +20% damage
    let a1 = aggregate_cards(&c1);
    assert!((a1.damage_mult - 1.20).abs() < 1e-3);

    // Two Spider Silks (+20% each)
    let c2 = vec!["spidersilk".to_string(), "spidersilk".to_string()];
    let a2 = aggregate_cards(&c2);
    // Raw is 1.44, softened against best (1.20) lands at ~1.43
    assert!(a2.damage_mult < 1.44);
    assert!(a2.damage_mult > 1.42);

    // Set bonus: Storm (2 thunderbolts -> +25% damage mult)
    let c_storm = vec!["wispspark".to_string(), "tempestcrown".to_string()];
    let a_storm = aggregate_cards(&c_storm);
    assert!(a_storm.bolt);
    assert!(a_storm.damage_mult > 1.5); // Tempest Crown 1.5 + Storm set bonus 1.25 softened
}

#[test]
fn weapon_socketing_and_durability_top_up() {
    let mut weapon = Weapon::new(WeaponId::Sword, ItemRarity::Epic);
    weapon.durability = Some(100);

    assert_eq!(weapon.slot_count(), 3);

    // Socket Shambler Hide (+35% durability)
    let ok = socket_card(&mut weapon, "shamblerhide");
    assert!(ok);
    assert_eq!(weapon.cards.len(), 1);
    // Durability tops up proportionally
    assert!(weapon.durability.unwrap() > 100);

    // Weapon kinds restriction: Ranged-only card cannot socket into Sword (Melee)
    let ok_ranged = socket_card(&mut weapon, "webspinnersilk");
    assert!(!ok_ranged);
}

#[test]
fn card_reader_stack_haul_sorting() {
    let entries = vec![
        HaulEntry {
            id: "spidersilk".to_string(),
            note: Some("STASHED".to_string()),
            fresh: true,
        },
        HaulEntry {
            id: "spidersilk".to_string(),
            note: Some("STASHED".to_string()),
            fresh: false,
        },
        HaulEntry {
            id: "tempestcrown".to_string(), // Mythic
            note: Some("SOCKETED".to_string()),
            fresh: true,
        },
        HaulEntry {
            id: "spidersilk#4s".to_string(), // Common Shiny Level 4
            note: None,
            fresh: false,
        },
    ];

    let stacks = stack_haul(&entries);
    assert_eq!(stacks.len(), 3);

    // Mythic Tempest Crown leads the haul
    assert_eq!(stacks[0].id, "tempestcrown");
    assert_eq!(stacks[0].count, 1);

    // Shiny Level 4 Spider Silk is second
    assert_eq!(stacks[1].id, "spidersilk#4s");
    assert_eq!(stacks[1].count, 1);

    // Plain Spider Silk is third with count 2
    assert_eq!(stacks[2].id, "spidersilk");
    assert_eq!(stacks[2].count, 2);
}

#[test]
fn card_drop_rates_and_affinity() {
    let mut rng_val = 0.005; // Less than 0.01 common drop chance
    let mut dummy_rng = || {
        let v = rng_val;
        rng_val += 0.001;
        v
    };

    let opts = DropOpts {
        floor: 1,
        boss: false,
        gold_wall: false,
        legendary_allowed: false,
        mythic_allowed: false,
        kind: Some(EnemyKind::Spider),
        sub_type: None,
        drop_mult: Some(1.0),
        affinity: Some(1.0),
        guaranteed: false,
    };

    let drop = roll_card_drop(&opts, &mut dummy_rng);
    assert_eq!(drop, Some("spidersilk"));
}
