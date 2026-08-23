// Parity test for Player Abilities, Skills, Mana Engine & Skill Runtime.
// Replicates legacy/src/game/pinball-knight/abilities.ts, skills.ts, skill-runtime.ts

use pk_core::abilities::{AbilityEvent, AbilityId, AbilityProjectileTarget, PlayerAbilitiesRuntime};
use pk_core::constants::skills::*;
use pk_core::player::skill_runtime::SkillRuntimeState;
use pk_core::skills::SkillAggregate;

#[test]
fn abilities_constants_and_defs_match_authored_oracle() {
    assert_eq!(AbilityId::ALL.len(), 6);

    let fc = AbilityId::Flippercharge.def();
    assert_eq!(fc.cost, 20);
    assert_eq!(fc.cooldown, 3.5);

    let ap = AbilityId::Arcanepulse.def();
    assert_eq!(ap.cost, 35);
    assert_eq!(ap.cooldown, 5.0);

    let ma = AbilityId::Magnetaura.def();
    assert_eq!(ma.cost, 25);
    assert_eq!(ma.cooldown, 7.0);

    let tc = AbilityId::Timecrawl.def();
    assert_eq!(tc.cost, 50);
    assert_eq!(tc.cooldown, 11.0);

    let bs = AbilityId::Bladestorm.def();
    assert_eq!(bs.cost, 40);
    assert_eq!(bs.cooldown, 9.0);

    let sf = AbilityId::Slickfield.def();
    assert_eq!(sf.cost, 25);
    assert_eq!(sf.cooldown, 8.0);
}

#[test]
fn cast_anticipation_windup_and_impact_timing() {
    let mut runtime = PlayerAbilitiesRuntime::default();
    let agg = SkillAggregate::default();
    let mut events = Vec::new();

    // Slot 0 is Flippercharge (cost 20, windup 0.08, cooldown 3.5)
    assert!(runtime.can_cast(0, &agg));
    let cast_ok = runtime.cast_ability(0, &agg, &mut events);
    assert!(cast_ok);
    assert_eq!(runtime.mana, 80.0);
    assert_eq!(runtime.casts.len(), 1);
    assert_eq!(runtime.casts[0].id, AbilityId::Flippercharge);
    assert_eq!(runtime.casts[0].windup, 0.08);
    assert_eq!(events.len(), 1);
    assert!(matches!(events[0], AbilityEvent::CastStarted { .. }));

    // Ticking 0.04s: windup still in progress (0.04 < 0.08)
    let evts = runtime.tick(0.04, &agg, &mut [], &mut [], &mut []);
    assert!(!runtime.casts[0].fired);
    assert!(evts.is_empty());

    // Ticking 0.05s more (total 0.09 > 0.08): fires impact frame
    let evts = runtime.tick(0.05, &agg, &mut [], &mut [], &mut []);
    assert!(runtime.casts[0].fired);
    assert!(evts.iter().any(|e| matches!(e, AbilityEvent::ImpactFrame { .. })));
    assert_eq!(runtime.mom_speed, FLIPPER_LAUNCH_SPEED);
}

#[test]
fn blood_price_keystone_spends_hearts_on_empty_mana() {
    let mut runtime = PlayerAbilitiesRuntime::default();
    runtime.mana = 5.0; // insufficient for Arcane Pulse (cost 35)
    runtime.hp = 4;
    runtime.ability_slots[0] = Some(AbilityId::Arcanepulse);

    let mut agg = SkillAggregate::default();
    // Without Blood Price: unaffordable
    assert!(!runtime.can_cast(0, &agg));

    // Enable Blood Price keystone
    agg.blood_price = true;
    assert!(runtime.can_cast(0, &agg));

    let mut events = Vec::new();
    let cast_ok = runtime.cast_ability(0, &agg, &mut events);
    assert!(cast_ok);
    assert_eq!(runtime.mana, 0.0);
    assert_eq!(runtime.hp, 3); // Paid 1 heart
    assert!(events.iter().any(|e| matches!(e, AbilityEvent::BloodPricePaid { hp_cost: 1 })));

    // Soft-failure rule: cannot cast if hp <= BLOOD_PRICE_HP (1)
    runtime.hp = 1;
    assert!(!runtime.can_cast(0, &agg));
}

#[test]
fn table_mana_battery_and_dynamo_keystone() {
    let mut runtime = PlayerAbilitiesRuntime::default();
    runtime.mana = 20.0;
    let mut agg = SkillAggregate::default();

    // Standard passive regen
    let _ = runtime.tick(1.0, &agg, &mut [], &mut [], &mut []);
    assert!((runtime.mana - (20.0 + MANA_REGEN)).abs() < 1e-6);

    // Bounce combo trickles extra mana
    runtime.bounce_combo = 3;
    let _ = runtime.tick(0.1, &agg, &mut [], &mut [], &mut []);
    assert!(runtime.mana > 20.0 + MANA_REGEN + MANA_PER_BOUNCE * 2.0);

    // Dynamo keystone: cuts passive regen to 0, boosts bounces by 3.2x
    agg.dynamo = true;
    let mana_before = runtime.mana;
    let _ = runtime.tick(1.0, &agg, &mut [], &mut [], &mut []);
    assert_eq!(runtime.mana, mana_before); // zero passive regen

    runtime.bounce_combo = 4; // 1 new bounce
    let _ = runtime.tick(0.1, &agg, &mut [], &mut [], &mut []);
    let expected_gain = MANA_PER_BOUNCE * DYNAMO_BOUNCE_MULT;
    assert!((runtime.mana - (mana_before + expected_gain)).abs() < 0.1);
}

#[test]
fn rank_2_extra_rules_for_all_abilities() {
    let mut runtime = PlayerAbilitiesRuntime::default();
    let agg = SkillAggregate::default();

    // Set rank 2 for Arcane Pulse and Time Crawl
    runtime.ability_ranks.insert(AbilityId::Arcanepulse, 2);
    runtime.ability_ranks.insert(AbilityId::Timecrawl, 2);
    runtime.ability_ranks.insert(AbilityId::Bladestorm, 2);
    runtime.ability_ranks.insert(AbilityId::Slickfield, 2);

    let mut events = Vec::new();

    // Arcane Pulse at rank 2 spawns Lightning Rod floor FX
    runtime.fire_ability(AbilityId::Arcanepulse, 1.0, &mut events);
    assert!(events.iter().any(|e| matches!(e, AbilityEvent::FloorFxSpawned { kind: "rod", .. })));

    // Time Crawl at rank 2 spawns 6 frost runes
    events.clear();
    runtime.fire_ability(AbilityId::Timecrawl, 1.0, &mut events);
    let frost_count = events
        .iter()
        .filter(|e| matches!(e, AbilityEvent::FloorFxSpawned { kind: "frost", .. }))
        .count();
    assert_eq!(frost_count, 6);

    // Slick Field at rank 2 spawns oil + tar core
    events.clear();
    runtime.fire_ability(AbilityId::Slickfield, 1.0, &mut events);
    assert!(events.iter().any(|e| matches!(e, AbilityEvent::FloorFxSpawned { kind: "oil", .. })));
    assert!(events.iter().any(|e| matches!(e, AbilityEvent::FloorFxSpawned { kind: "tar", .. })));

    // Blade Storm at rank 2 shreds hostile projectiles
    events.clear();
    runtime.fire_ability(AbilityId::Bladestorm, 1.0, &mut events);
    let mut projs = vec![AbilityProjectileTarget {
        idx: 0,
        x: 0.5,
        z: 0.5,
        hostile: true,
        alive: true,
    }];
    let evts = runtime.tick(0.01, &agg, &mut [], &mut [], &mut projs);
    assert!(!projs[0].alive);
    assert!(evts.iter().any(|e| matches!(e, AbilityEvent::HostileProjectileShredded { .. })));
}

#[test]
fn skill_tree_progression_aggregation_and_xp() {
    let mut state = SkillRuntimeState::new();
    assert_eq!(state.player_max_hp(None), 6);
    assert_eq!(state.player_mana_max(None), 100);

    // Grant 150 XP -> level 1 (40) + level 2 (98) -> level 3, 2 skill points earned
    let levels = state.award(150.0, None);
    assert_eq!(levels, 2);
    assert_eq!(state.level, 3);
    assert_eq!(state.skill_points, 2);

    // Spend 1 point on Whetstone (+6% damage)
    let spend_res = state.spend_skill_point("whetstone");
    assert!(spend_res.is_ok());
    assert_eq!(state.skill_points, 1);

    let agg = state.skill_agg(None);
    assert!((agg.damage_mult - 1.06).abs() < 1e-6);

    // Learn prerequisite tree: Iron Heart (+1 HP) requires Whetstone
    let iron_res = state.spend_skill_point("ironheart");
    assert!(iron_res.is_ok());
    assert_eq!(state.player_max_hp(None), 7);
}
