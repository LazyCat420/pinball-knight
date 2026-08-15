// Parity test suite for Skill Tree Runtime Progression.
// Replicates legacy/src/game/pinball-knight/skill-runtime.ts

use pk_core::player::skill_runtime::{SkillRuntimeState, MANA_POOL_FLOOR, PLAYER_MAX_HP};

#[test]
fn skill_runtime_defaults_and_xp_leveling() {
    let mut state = SkillRuntimeState::new();

    assert_eq!(state.player_max_hp(), PLAYER_MAX_HP);
    assert_eq!(state.player_mana_max(), 100);
    assert_eq!(state.skill_points, 0);

    // Grant 250 XP -> 2 skill points earned
    assert!(state.grant_xp(250));
    assert_eq!(state.skill_points, 2);

    // Grant 30 XP -> no new point
    assert!(!state.grant_xp(30));
    assert_eq!(state.skill_points, 2);
}

#[test]
fn spending_skill_points_modifies_stats_and_unlocks_abilities() {
    let mut state = SkillRuntimeState::new();
    state.grant_xp(300); // 3 points

    assert!(state.spend_skill_point("iron_heart", 20, 0, None));
    assert_eq!(state.player_max_hp(), 120);
    assert_eq!(state.skill_points, 2);

    assert!(state.spend_skill_point("arcane_mastery", 0, 30, Some("fireball")));
    assert_eq!(state.player_mana_max(), 130);
    assert!(state.unlocked_abilities.contains(&"fireball".to_string()));
    assert_eq!(state.skill_points, 1);
}

#[test]
fn player_mana_max_is_floored_above_pool_floor() {
    let mut state = SkillRuntimeState::new();
    state.grant_xp(100);

    // Blood price keystone with heavy -90 mana penalty
    assert!(state.spend_skill_point("blood_price", 50, -90, None));
    assert_eq!(state.player_max_hp(), 150);
    assert_eq!(state.player_mana_max(), MANA_POOL_FLOOR);
}
