// Parity test suite for Skill Tree Runtime Progression.
// Replicates legacy/src/game/pinball-knight/skill-runtime.ts

use pk_core::abilities::AbilityId;
use pk_core::constants::skills::{MANA_MAX, MANA_POOL_FLOOR};
use pk_core::player::skill_runtime::{SkillRuntimeState, PLAYER_MAX_HP};

#[test]
fn skill_runtime_defaults_and_xp_leveling() {
    let mut state = SkillRuntimeState::new();

    assert_eq!(state.player_max_hp(None), PLAYER_MAX_HP);
    assert_eq!(state.player_mana_max(None), MANA_MAX);
    assert_eq!(state.skill_points, 0);

    // Grant 150 XP -> level 1 (40) + level 2 (98) = 138 XP -> level 3, 2 skill points earned
    let gained = state.award(150.0, None);
    assert_eq!(gained, 2);
    assert_eq!(state.level, 3);
    assert_eq!(state.skill_points, 2);

    // Grant 30 XP -> 12 + 30 = 42 < 167 needed for level 4 -> 0 new levels
    let gained2 = state.award(30.0, None);
    assert_eq!(gained2, 0);
    assert_eq!(state.skill_points, 2);
}

#[test]
fn spending_skill_points_modifies_stats_and_unlocks_abilities() {
    let mut state = SkillRuntimeState::new();
    state.skill_points = 5;

    // Learn Iron Heart (requires Whetstone first)
    assert!(state.spend_skill_point("ironheart").is_err()); // Prereq not met
    assert!(state.spend_skill_point("whetstone").is_ok());
    assert!(state.spend_skill_point("ironheart").is_ok());
    assert_eq!(state.player_max_hp(None), PLAYER_MAX_HP + 1);

    // Learn Mana Well -> unlocks +15 max mana
    assert!(state.spend_skill_point("manawell").is_ok());
    assert_eq!(state.player_mana_max(None), MANA_MAX + 15);

    // Learn Magnet Aura unlock
    assert!(state.spend_skill_point("unlockmagnet").is_ok());
    let unlocked = state.unlocked_abilities(None);
    assert!(unlocked.contains(&AbilityId::Magnetaura));
}

#[test]
fn player_mana_max_is_floored_above_pool_floor() {
    let mut state = SkillRuntimeState::new();
    state.skill_points = 10;

    // Learn prerequisites leading to Blood Price
    assert!(state.spend_skill_point("whetstone").is_ok());
    assert!(state.spend_skill_point("ironheart").is_ok());
    assert!(state.spend_skill_point("juggernaut").is_ok());
    assert!(state.spend_skill_point("bloodprice").is_ok()); // -30 max mana

    // Mana max drops from 100 to 70, well above MANA_POOL_FLOOR (55)
    assert_eq!(state.player_mana_max(None), 70);

    // Extra penalty floored
    state.invalidate_skill_agg();
    let penalty_mod = pk_core::skills::SkillModifier {
        mana_max_flat: Some(-100),
        ..pk_core::skills::SkillModifier::EMPTY
    };
    assert_eq!(state.player_mana_max(Some(&penalty_mod)), MANA_POOL_FLOOR);
}
