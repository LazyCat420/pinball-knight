//! Skill Runtime — Live glue between pure skill tree, XP progression, and derived stats.
//!
//! PORTS-PARTIAL: `skill-runtime.ts` - NOT a finished port - 4 of 12 exported names carried over (33%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

use std::collections::HashMap;

pub const PLAYER_MAX_HP: i32 = 100;
pub const MANA_MAX: i32 = 100;
pub const MANA_POOL_FLOOR: i32 = 20;
pub const XP_KILL: u32 = 10;
pub const XP_KILL_BOSS: u32 = 150;

#[derive(Clone, Debug, PartialEq)]
pub struct SkillRuntimeState {
    pub skill_ranks: HashMap<String, usize>,
    pub bonus_max_hp: i32,
    pub max_hp_flat: i32,
    pub mana_max_flat: i32,
    pub xp: u32,
    pub skill_points: u32,
    pub unlocked_abilities: Vec<String>,
}

impl Default for SkillRuntimeState {
    fn default() -> Self {
        Self {
            skill_ranks: HashMap::new(),
            bonus_max_hp: 0,
            max_hp_flat: 0,
            mana_max_flat: 0,
            xp: 0,
            skill_points: 0,
            unlocked_abilities: vec!["dash".to_string(), "slash".to_string()],
        }
    }
}

impl SkillRuntimeState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Evaluates total max HP = base (100) + tree modifier + Elixir bonus.
    pub fn player_max_hp(&self) -> i32 {
        PLAYER_MAX_HP + self.max_hp_flat + self.bonus_max_hp
    }

    /// Evaluates total max mana, strictly floored above MANA_POOL_FLOOR (20).
    pub fn player_mana_max(&self) -> i32 {
        (MANA_MAX + self.mana_max_flat).max(MANA_POOL_FLOOR)
    }

    /// Awards XP. Every 100 XP grants 1 skill point. Returns true if a point was earned.
    pub fn grant_xp(&mut self, amount: u32) -> bool {
        let old_level = self.xp / 100;
        self.xp += amount;
        let new_level = self.xp / 100;
        if new_level > old_level {
            self.skill_points += new_level - old_level;
            true
        } else {
            false
        }
    }

    pub fn xp_for_floor_clear(floor_num: u32) -> u32 {
        100 * floor_num
    }

    /// Spends 1 skill point on a skill rank, applying flat HP/mana bonuses and optional ability unlock.
    pub fn spend_skill_point(
        &mut self,
        skill_name: &str,
        hp_gain: i32,
        mana_gain: i32,
        ability_unlock: Option<&str>,
    ) -> bool {
        if self.skill_points == 0 {
            return false;
        }

        self.skill_points -= 1;
        let rank = self.skill_ranks.entry(skill_name.to_string()).or_insert(0);
        *rank += 1;

        self.max_hp_flat += hp_gain;
        self.mana_max_flat += mana_gain;

        if let Some(ability) = ability_unlock {
            if !self.unlocked_abilities.iter().any(|a| a == ability) {
                self.unlocked_abilities.push(ability.to_string());
            }
        }

        true
    }
}
