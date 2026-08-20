//! SKILL RUNTIME — the live glue between the pure tree (skills.ts) and the game.
//!
//! Port of `legacy/src/game/pinball-knight/skill-runtime.ts` (158 lines).
//!
//! PORTS: `skill-runtime.ts`

use std::collections::HashMap;

use crate::abilities::{ability_rank, ability_rank_cost, AbilityId};
use crate::constants::skills::{ABILITY_RANK_MAX, MANA_MAX, MANA_POOL_FLOOR};
use crate::skills::{
    aggregate_skills, can_learn, get_skill, grant_xp, xp_for_floor_clear, SkillAggregate,
    SkillModifier, XpState, XP_KILL, XP_KILL_BOSS,
};

pub const PLAYER_MAX_HP: i32 = 6;

#[derive(Clone, Debug, PartialEq)]
pub struct SkillRuntimeState {
    pub skill_ranks: HashMap<String, usize>,
    pub ability_ranks: HashMap<AbilityId, usize>,
    pub bonus_max_hp: i32,
    pub xp: f64,
    pub level: usize,
    pub skill_points: usize,
    pub unlocked_abilities: Vec<AbilityId>,
    pub ability_slots: [Option<AbilityId>; 2],
    pub ability_cd: HashMap<AbilityId, f64>,
    cached_agg: Option<SkillAggregate>,
}

impl Default for SkillRuntimeState {
    fn default() -> Self {
        Self {
            skill_ranks: HashMap::new(),
            ability_ranks: HashMap::new(),
            bonus_max_hp: 0,
            xp: 0.0,
            level: 1,
            skill_points: 0,
            unlocked_abilities: vec![AbilityId::Flippercharge, AbilityId::Arcanepulse],
            ability_slots: [Some(AbilityId::Flippercharge), Some(AbilityId::Arcanepulse)],
            ability_cd: HashMap::new(),
            cached_agg: None,
        }
    }
}

impl SkillRuntimeState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn invalidate_skill_agg(&mut self) {
        self.cached_agg = None;
    }

    pub fn skill_agg(&mut self, base: Option<&SkillModifier>) -> SkillAggregate {
        if let Some(ref agg) = self.cached_agg {
            return agg.clone();
        }
        let agg = aggregate_skills(&self.skill_ranks, base);
        self.cached_agg = Some(agg.clone());
        agg
    }

    pub fn player_max_hp(&mut self, base: Option<&SkillModifier>) -> i32 {
        let agg = self.skill_agg(base);
        PLAYER_MAX_HP + agg.max_hp_flat + self.bonus_max_hp
    }

    pub fn player_mana_max(&mut self, base: Option<&SkillModifier>) -> i32 {
        let agg = self.skill_agg(base);
        (MANA_MAX + agg.mana_max_flat).max(MANA_POOL_FLOOR)
    }

    pub fn unlocked_abilities(&mut self, base: Option<&SkillModifier>) -> Vec<AbilityId> {
        let agg = self.skill_agg(base);
        let mut out = self.unlocked_abilities.clone();
        for unl in &agg.unlocked {
            if let Some(id) = AbilityId::from_str_id(unl) {
                if !out.contains(&id) {
                    out.push(id);
                }
            }
        }
        out
    }

    pub fn sync_ability_slots(&mut self, base: Option<&SkillModifier>) -> bool {
        let ok = self.unlocked_abilities(base);
        let mut changed = false;
        for slot in 0..2 {
            if let Some(id) = self.ability_slots[slot] {
                if !ok.contains(&id) {
                    self.ability_slots[slot] = None;
                    self.ability_cd.remove(&id);
                    changed = true;
                }
            }
        }
        changed
    }

    pub fn award(&mut self, amount: f64, base: Option<&SkillModifier>) -> usize {
        let xp_mult = self.skill_agg(base).xp_mult;
        let res = grant_xp(
            &XpState {
                xp: self.xp,
                level: self.level,
                points: self.skill_points,
            },
            amount * xp_mult,
        );
        self.xp = res.xp;
        self.level = res.level;
        self.skill_points = res.points;
        res.levels_gained
    }

    pub fn award_kill_xp(&mut self, boss: bool, base: Option<&SkillModifier>) -> usize {
        self.award(if boss { XP_KILL_BOSS } else { XP_KILL }, base)
    }

    pub fn award_floor_xp(&mut self, floor: u32, grade: &str, base: Option<&SkillModifier>) -> usize {
        self.award(xp_for_floor_clear(floor, grade), base)
    }

    pub fn spend_ability_rank(
        &mut self,
        id: AbilityId,
        base: Option<&SkillModifier>,
    ) -> Result<(), &'static str> {
        let unlocked = self.unlocked_abilities(base);
        if !unlocked.contains(&id) {
            return Err("ability not unlocked");
        }
        let rank = ability_rank(id, &self.ability_ranks);
        if rank >= ABILITY_RANK_MAX {
            return Err("maxed");
        }
        let cost = ability_rank_cost(rank);
        if self.skill_points < cost {
            return Err("not enough skill points");
        }
        self.ability_ranks.insert(id, rank + 1);
        self.skill_points -= cost;
        Ok(())
    }

    pub fn spend_skill_point(&mut self, id: &str) -> Result<(), &'static str> {
        if !can_learn(id, &self.skill_ranks, self.skill_points) {
            return Err("prerequisites or points not met");
        }
        let def = match get_skill(id) {
            Some(d) => d,
            None => return Err("unknown skill node"),
        };
        let current_rank = *self.skill_ranks.get(id).unwrap_or(&0);
        self.skill_ranks.insert(id.to_string(), current_rank + 1);
        self.skill_points -= def.cost;
        self.invalidate_skill_agg();

        if let Some(unl) = def.modifier.unlock_ability {
            if let Some(aid) = AbilityId::from_str_id(unl) {
                if !self.unlocked_abilities.contains(&aid) {
                    self.unlocked_abilities.push(aid);
                }
            }
        }

        Ok(())
    }
}
