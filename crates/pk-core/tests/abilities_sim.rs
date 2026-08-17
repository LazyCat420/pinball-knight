use pk_core::abilities::*;
use pk_core::state::Player;

#[test]
fn all_six_abilities_have_valid_metadata() {
    assert_eq!(ABILITY_IDS.len(), 6);
    for id in ABILITY_IDS {
        let def = id.def();
        assert!(def.cost > 0);
        assert!(def.cooldown > 0.0);
        assert!(!def.label.is_empty());
        assert!(!def.icon.is_empty());
        assert!(def.color.starts_with('#'));
        assert_eq!(AbilityId::from_str_id(id.as_str()), Some(id));
    }
}

#[test]
fn ability_ranks_and_power_scaling() {
    let ranks = [1, 2, 0, 0, 0, 0];
    assert_eq!(ability_rank(&ranks, AbilityId::Flippercharge), 1);
    assert_eq!(ability_rank(&ranks, AbilityId::Arcanepulse), 2);
    assert_eq!(ability_rank(&ranks, AbilityId::Magnetaura), 0);

    assert_eq!(ability_rank_cost(0), 1);
    assert_eq!(ability_rank_cost(1), 2);
    assert_eq!(ability_rank_cost(2), 3);

    // Power increases with rank and momentum
    let power_base = ability_power(0, 0.0, 0.0);
    assert_eq!(power_base, 1.0);

    let power_r2 = ability_power(2, 0.0, 0.0);
    assert!(power_r2 > power_base);

    let power_mom = ability_power(2, 15.0, 0.5);
    assert!(power_mom > power_r2);
}

#[test]
fn mana_affordability_and_blood_price() {
    let mut player = Player::default();
    let abilities = PlayerAbilities::default();

    player.mana = 30.0;
    player.hp = 100.0;

    // Flipper charge costs 20 -> affordable
    assert!(affordable(AbilityId::Flippercharge, player.mana, player.hp, false));
    assert!(can_cast(0, &abilities, player.mana, player.hp, false));

    // Arcane pulse costs 35 -> not affordable with 30 mana
    assert!(!affordable(AbilityId::Arcanepulse, player.mana, player.hp, false));
    assert!(!can_cast(1, &abilities, player.mana, player.hp, false));

    // Under Blood Price with sufficient HP, Arcane Pulse is affordable
    assert!(affordable(AbilityId::Arcanepulse, player.mana, player.hp, true));
    assert!(can_cast(1, &abilities, player.mana, player.hp, true));

    // But if HP is too low, Blood Price does not allow suicidal cast
    player.hp = 10.0;
    assert!(!affordable(AbilityId::Arcanepulse, player.mana, player.hp, true));
}

#[test]
fn cast_ability_pipeline_and_execution() {
    let mut player = Player::default();
    let mut abilities = PlayerAbilities::default();
    player.mana = 100.0;
    player.hp = 100.0;

    assert_eq!(casts_in_flight(&abilities), 0);

    // Cast slot 0 (Flipper Charge)
    let started = cast_ability(0, &mut abilities, &mut player, false, 1.0);
    assert!(started);
    assert_eq!(casts_in_flight(&abilities), 1);
    assert_eq!(player.mana, 80.0); // 100 - 20
    assert!(abilities.slot_1.cooldown_t > 0.0);

    // Ticking through wind-up triggers launch effect
    let anim = get_cast_anim(AbilityId::Flippercharge);
    tick_abilities(&mut abilities, &mut player, 100.0, anim.windup + 0.01);
    assert!(player.mom_speed >= FLIPPER_LAUNCH_SPEED);

    // Ticking through recovery cleans up cast anim
    tick_abilities(&mut abilities, &mut player, 100.0, anim.recover + 0.01);
    assert_eq!(casts_in_flight(&abilities), 0);
}

#[test]
fn reset_ability_scratch_clears_transient_state() {
    let mut abilities = PlayerAbilities::default();
    let mut player = Player::default();
    player.mana = 100.0;
    player.hp = 100.0;

    cast_ability(0, &mut abilities, &mut player, false, 1.0);
    assert_eq!(casts_in_flight(&abilities), 1);

    reset_ability_scratch(&mut abilities);
    assert_eq!(casts_in_flight(&abilities), 0);
    assert_eq!(abilities.pulse_waves.len(), 0);
}
