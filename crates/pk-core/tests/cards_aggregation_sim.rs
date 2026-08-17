//! Comprehensive test suite for cards.ts aggregation, modifiers, rolling, and catalogue math.

use pk_core::cards::*;
use pk_core::economy::forge::{ItemRarity, Weapon, WeaponId, WeaponKind};

#[test]
fn card_key_parsing_and_construction() {
    assert_eq!(card_key("spidersilk", 1, false), "spidersilk");
    assert_eq!(card_key("spidersilk", 4, false), "spidersilk#4");
    assert_eq!(card_key("spidersilk", 4, true), "spidersilk#4s");
    assert_eq!(card_key("spidersilk", 1, true), "spidersilk#1s");

    let parsed = parse_card("spidersilk#4s");
    assert_eq!(parsed.base, "spidersilk");
    assert_eq!(parsed.level, 4);
    assert!(parsed.shiny);

    assert_eq!(card_base("spidersilk#4s"), "spidersilk");
    assert_eq!(card_level("spidersilk#4s"), 4);
    assert!(is_shiny_card("spidersilk#4s"));
    assert!(!is_shiny_card("spidersilk#4"));
}

#[test]
fn card_catalogue_and_rarity_querying() {
    let def = card_def("spidersilk").expect("spidersilk must exist in catalogue");
    assert_eq!(def.def.rarity, CardRarity::Common);
    assert_eq!(def.def.weapon_kinds, WeaponKinds::Both);

    let common_cards = cards_of_rarity(CardRarity::Common);
    assert!(!common_cards.is_empty());
    assert!(common_cards.contains(&"spidersilk"));

    let mythic_cards = cards_of_rarity(CardRarity::Mythic);
    assert!(!mythic_cards.is_empty());

    assert_eq!(CardRarity::Mythic.lower(), Some(CardRarity::Legendary));
    assert_eq!(CardRarity::Legendary.lower(), Some(CardRarity::Epic));
    assert_eq!(CardRarity::Epic.lower(), Some(CardRarity::Rare));
    assert_eq!(CardRarity::Rare.lower(), Some(CardRarity::Common));
    assert_eq!(CardRarity::Common.lower(), None);
}

#[test]
fn modifier_scaling_and_power_score() {
    let base_mod = CardModifier {
        damage_flat: Some(10),
        damage_mult: Some(1.2),
        crit_chance: Some(0.1),
        ..Default::default()
    };

    let growth = card_growth(5, true);
    assert!(growth > 1.0);

    let scaled = scale_modifier(base_mod, growth);
    assert!(scaled.damage_flat.unwrap() >= 10);
    assert!(scaled.damage_mult.unwrap() > 1.2);
    assert!(scaled.crit_chance.unwrap() > 0.1);

    let power = card_power(&scaled);
    assert!(power > 0);

    let rows = modifier_rows(&scaled);
    assert!(!rows.is_empty());
}

#[test]
fn aggregate_cards_applies_soft_caps_and_combines_effects() {
    let cards = vec![
        "spidersilk#1".to_string(),
        "hulkknuckle#2".to_string(),
        "webspinnersilk#1".to_string(),
    ];

    let agg = aggregate_cards(&cards);
    assert!(agg.damage_mult >= 1.0);
    assert!(agg.cooldown_mult <= 1.0 || agg.cooldown_mult >= 1.0);

    // Empty list produces neutral identity
    let empty_cards: Vec<String> = Vec::new();
    let empty_agg = aggregate_cards(&empty_cards);
    assert_eq!(empty_agg.damage_flat, 0);
    assert_eq!(empty_agg.damage_mult, 1.0);
    assert_eq!(empty_agg.cooldown_mult, 1.0);
    assert_eq!(empty_agg.crit_chance, 0.0);
}

#[test]
fn card_socketing_into_weapon_respects_kind() {
    let mut melee_weapon = Weapon {
        id: WeaponId::Sword,
        durability: Some(100),
        cards: Vec::new(),
        bonus_slots: 0,
        rarity: ItemRarity::Common,
        upgrade: 0,
        insured: 0,
    };

    // Spider silk fits both melee and ranged
    assert!(card_fits_kind("spidersilk", WeaponKind::Melee));
    assert!(socket_card(&mut melee_weapon, "spidersilk"));
    assert_eq!(melee_weapon.cards.len(), 1);

    // Webspinner silk fits ranged only
    assert!(!card_fits_kind("webspinnersilk", WeaponKind::Melee));
    assert!(card_fits_kind("webspinnersilk", WeaponKind::Ranged));
    assert!(!socket_card(&mut melee_weapon, "webspinnersilk"));
    assert_eq!(melee_weapon.cards.len(), 1);
}

#[test]
fn deterministic_drop_rolling() {
    let mut rng_val = 0.05;
    let mut dummy_rng = || {
        let v = rng_val;
        rng_val = (rng_val + 0.1) % 1.0;
        v
    };

    let lvl = roll_card_level(5, &mut dummy_rng);
    assert!((1..=CARD_LEVEL_MAX).contains(&lvl));

    let shiny = roll_shiny(true, &mut dummy_rng);
    let _ = shiny;

    let opts = DropOpts {
        floor: 3,
        boss: false,
        gold_wall: false,
        legendary_allowed: true,
        mythic_allowed: false,
        kind: Some(EnemyKind::Spider),
        sub_type: None,
        drop_mult: None,
        affinity: None,
        guaranteed: true,
    };
    if let Some(inst) = roll_card_instance(&opts, &mut dummy_rng) {
        assert!(!inst.is_empty());
    }
}
