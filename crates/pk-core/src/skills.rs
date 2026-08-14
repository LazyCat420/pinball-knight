//! 🌟 SKILLS — In-run skill tree, modifiers aggregation, prerequisites, and XP curve.
//!
//! PORTS: `skills.ts`

use std::collections::HashMap;
use crate::abilities::AbilityId;

pub const MOVE_SPEED_MULT_CAP: f64 = 1.5;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SkillBranch {
    Steel,
    Flipper,
    Arcana,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct SkillModifier {
    pub damage_mult: Option<f64>,
    pub move_speed_mult: Option<f64>,
    pub max_hp_flat: Option<i32>,
    pub mana_max_flat: Option<f64>,
    pub cooldown_mult: Option<f64>,
    pub gold_mult: Option<f64>,
    pub pinball_damage_mult: Option<f64>,
    pub xp_mult: Option<f64>,
    pub unlock_ability: Option<AbilityId>,
    pub momentum_cooldown_rate: Option<f64>,
    pub momentum_ability_power: Option<f64>,
    pub blood_price: bool,
    pub cinder_wake: bool,
    pub dynamo: bool,
}

#[derive(Debug, Clone)]
pub struct SkillNodeDef {
    pub id: &'static str,
    pub label: &'static str,
    pub icon: &'static str,
    pub description: &'static str,
    pub branch: SkillBranch,
    pub row: usize,
    pub max_rank: u32,
    pub cost: u32,
    pub requires: &'static [&'static str],
    pub modifier: SkillModifier,
}

pub static SKILL_NODES: &[SkillNodeDef] = &[
    // ── STEEL ──
    SkillNodeDef {
        id: "whetstone",
        label: "Whetstone",
        icon: "🗡️",
        description: "+6% damage per rank",
        branch: SkillBranch::Steel,
        row: 0,
        max_rank: 3,
        cost: 1,
        requires: &[],
        modifier: SkillModifier {
            damage_mult: Some(1.06),
            ..SkillModifier::new()
        },
    },
    SkillNodeDef {
        id: "ironheart",
        label: "Iron Heart",
        icon: "❤️",
        description: "+1 max heart per rank",
        branch: SkillBranch::Steel,
        row: 1,
        max_rank: 2,
        cost: 1,
        requires: &["whetstone"],
        modifier: SkillModifier {
            max_hp_flat: Some(1),
            ..SkillModifier::new()
        },
    },
    SkillNodeDef {
        id: "juggernaut",
        label: "Juggernaut",
        icon: "🛡️",
        description: "+10% damage per rank",
        branch: SkillBranch::Steel,
        row: 2,
        max_rank: 2,
        cost: 2,
        requires: &["ironheart"],
        modifier: SkillModifier {
            damage_mult: Some(1.10),
            ..SkillModifier::new()
        },
    },
    SkillNodeDef {
        id: "bloodprice",
        label: "Blood Price",
        icon: "🩸",
        description: "KEYSTONE — cast with an empty pool, paying 1 heart. −30 max mana, forever.",
        branch: SkillBranch::Steel,
        row: 3,
        max_rank: 1,
        cost: 3,
        requires: &["juggernaut"],
        modifier: SkillModifier {
            blood_price: true,
            mana_max_flat: Some(-30.0),
            ..SkillModifier::new()
        },
    },
    // ── FLIPPER ──
    SkillNodeDef {
        id: "greasedgreaves",
        label: "Greased Greaves",
        icon: "👢",
        description: "+4% move speed per rank",
        branch: SkillBranch::Flipper,
        row: 0,
        max_rank: 3,
        cost: 1,
        requires: &[],
        modifier: SkillModifier {
            move_speed_mult: Some(1.04),
            ..SkillModifier::new()
        },
    },
    SkillNodeDef {
        id: "ballbearings",
        label: "Ball Bearings",
        icon: "🪩",
        description: "+15% damage while riding momentum, per rank",
        branch: SkillBranch::Flipper,
        row: 1,
        max_rank: 2,
        cost: 1,
        requires: &["greasedgreaves"],
        modifier: SkillModifier {
            pinball_damage_mult: Some(1.15),
            ..SkillModifier::new()
        },
    },
    SkillNodeDef {
        id: "coinmagnet",
        label: "Coin Magnet",
        icon: "🪙",
        description: "coins worth +10% per rank",
        branch: SkillBranch::Flipper,
        row: 1,
        max_rank: 2,
        cost: 1,
        requires: &["greasedgreaves"],
        modifier: SkillModifier {
            gold_mult: Some(1.10),
            ..SkillModifier::new()
        },
    },
    SkillNodeDef {
        id: "wreckingball",
        label: "Wrecking Ball",
        icon: "💥",
        description: "+25% damage while riding momentum",
        branch: SkillBranch::Flipper,
        row: 2,
        max_rank: 1,
        cost: 2,
        requires: &["ballbearings"],
        modifier: SkillModifier {
            pinball_damage_mult: Some(1.25),
            ..SkillModifier::new()
        },
    },
    SkillNodeDef {
        id: "overdrive",
        label: "Overdrive",
        icon: "⏩",
        description: "abilities cool down up to +35% faster per rank — scaled by your speed",
        branch: SkillBranch::Flipper,
        row: 3,
        max_rank: 2,
        cost: 1,
        requires: &["ballbearings"],
        modifier: SkillModifier {
            momentum_cooldown_rate: Some(0.35),
            ..SkillModifier::new()
        },
    },
    SkillNodeDef {
        id: "cinderwake",
        label: "Cinder Wake",
        icon: "🔥",
        description: "KEYSTONE — burn the floor whenever you are fast. Your own fire burns YOU.",
        branch: SkillBranch::Flipper,
        row: 4,
        max_rank: 1,
        cost: 3,
        requires: &["wreckingball"],
        modifier: SkillModifier {
            cinder_wake: true,
            ..SkillModifier::new()
        },
    },
    // ── ARCANA ──
    SkillNodeDef {
        id: "manawell",
        label: "Mana Well",
        icon: "🔮",
        description: "+15 max mana per rank",
        branch: SkillBranch::Arcana,
        row: 0,
        max_rank: 2,
        cost: 1,
        requires: &[],
        modifier: SkillModifier {
            mana_max_flat: Some(15.0),
            ..SkillModifier::new()
        },
    },
    SkillNodeDef {
        id: "swiftcasting",
        label: "Swift Casting",
        icon: "⚡",
        description: "-10% ability cooldowns per rank",
        branch: SkillBranch::Arcana,
        row: 1,
        max_rank: 2,
        cost: 1,
        requires: &["manawell"],
        modifier: SkillModifier {
            cooldown_mult: Some(0.90),
            ..SkillModifier::new()
        },
    },
    SkillNodeDef {
        id: "unlockmagnet",
        label: "Magnet Aura",
        icon: "🧲",
        description: "unlock the Magnet Aura ability",
        branch: SkillBranch::Arcana,
        row: 1,
        max_rank: 1,
        cost: 1,
        requires: &["manawell"],
        modifier: SkillModifier {
            unlock_ability: Some(AbilityId::MagnetAura),
            ..SkillModifier::new()
        },
    },
    SkillNodeDef {
        id: "unlocktimecrawl",
        label: "Time Crawl",
        icon: "⏳",
        description: "unlock the Time Crawl ability",
        branch: SkillBranch::Arcana,
        row: 2,
        max_rank: 1,
        cost: 2,
        requires: &["unlockmagnet"],
        modifier: SkillModifier {
            unlock_ability: Some(AbilityId::TimeCrawl),
            ..SkillModifier::new()
        },
    },
    SkillNodeDef {
        id: "unlockbladestorm",
        label: "Blade Storm",
        icon: "🌪️",
        description: "unlock the Blade Storm ability",
        branch: SkillBranch::Arcana,
        row: 2,
        max_rank: 1,
        cost: 2,
        requires: &["swiftcasting"],
        modifier: SkillModifier {
            unlock_ability: Some(AbilityId::BladeStorm),
            ..SkillModifier::new()
        },
    },
    SkillNodeDef {
        id: "unlockslick",
        label: "Slick Field",
        icon: "🛢️",
        description: "unlock the Slick Field ability",
        branch: SkillBranch::Arcana,
        row: 1,
        max_rank: 1,
        cost: 1,
        requires: &["manawell"],
        modifier: SkillModifier {
            unlock_ability: Some(AbilityId::SlickField),
            ..SkillModifier::new()
        },
    },
    SkillNodeDef {
        id: "kineticfocus",
        label: "Kinetic Focus",
        icon: "🎯",
        description: "+15% ability power per rank — scaled by your speed",
        branch: SkillBranch::Arcana,
        row: 3,
        max_rank: 2,
        cost: 1,
        requires: &["swiftcasting"],
        modifier: SkillModifier {
            momentum_ability_power: Some(0.15),
            ..SkillModifier::new()
        },
    },
    SkillNodeDef {
        id: "dynamo",
        label: "Dynamo",
        icon: "🔋",
        description: "KEYSTONE — bounces pay 3.2× mana. Mana no longer regenerates on its own.",
        branch: SkillBranch::Arcana,
        row: 4,
        max_rank: 1,
        cost: 3,
        requires: &["kineticfocus"],
        modifier: SkillModifier {
            dynamo: true,
            ..SkillModifier::new()
        },
    },
];

impl SkillModifier {
    pub const fn new() -> Self {
        Self {
            damage_mult: None,
            move_speed_mult: None,
            max_hp_flat: None,
            mana_max_flat: None,
            cooldown_mult: None,
            gold_mult: None,
            pinball_damage_mult: None,
            xp_mult: None,
            unlock_ability: None,
            momentum_cooldown_rate: None,
            momentum_ability_power: None,
            blood_price: false,
            cinder_wake: false,
            dynamo: false,
        }
    }
}

pub fn find_skill(id: &str) -> Option<&'static SkillNodeDef> {
    SKILL_NODES.iter().find(|s| s.id == id)
}

#[derive(Debug, Clone, PartialEq)]
pub struct SkillAggregate {
    pub damage_mult: f64,
    pub move_speed_mult: f64,
    pub max_hp_flat: i32,
    pub mana_max_flat: f64,
    pub cooldown_mult: f64,
    pub gold_mult: f64,
    pub pinball_damage_mult: f64,
    pub xp_mult: f64,
    pub momentum_cooldown_rate: f64,
    pub momentum_ability_power: f64,
    pub blood_price: bool,
    pub cinder_wake: bool,
    pub dynamo: bool,
    pub unlocked: Vec<AbilityId>,
}

impl Default for SkillAggregate {
    fn default() -> Self {
        Self {
            damage_mult: 1.0,
            move_speed_mult: 1.0,
            max_hp_flat: 0,
            mana_max_flat: 0.0,
            cooldown_mult: 1.0,
            gold_mult: 1.0,
            pinball_damage_mult: 1.0,
            xp_mult: 1.0,
            momentum_cooldown_rate: 0.0,
            momentum_ability_power: 0.0,
            blood_price: false,
            cinder_wake: false,
            dynamo: false,
            unlocked: Vec::new(),
        }
    }
}

pub fn fold_modifier(a: &mut SkillAggregate, m: &SkillModifier, times: u32) {
    for _ in 0..times {
        if let Some(v) = m.damage_mult {
            a.damage_mult *= v;
        }
        if let Some(v) = m.move_speed_mult {
            a.move_speed_mult *= v;
        }
        if let Some(v) = m.max_hp_flat {
            a.max_hp_flat += v;
        }
        if let Some(v) = m.mana_max_flat {
            a.mana_max_flat += v;
        }
        if let Some(v) = m.cooldown_mult {
            a.cooldown_mult *= v;
        }
        if let Some(v) = m.gold_mult {
            a.gold_mult *= v;
        }
        if let Some(v) = m.pinball_damage_mult {
            a.pinball_damage_mult *= v;
        }
        if let Some(v) = m.xp_mult {
            a.xp_mult *= v;
        }
        if let Some(v) = m.momentum_cooldown_rate {
            a.momentum_cooldown_rate += v;
        }
        if let Some(v) = m.momentum_ability_power {
            a.momentum_ability_power += v;
        }
    }
    if times > 0 {
        if m.blood_price {
            a.blood_price = true;
        }
        if m.cinder_wake {
            a.cinder_wake = true;
        }
        if m.dynamo {
            a.dynamo = true;
        }
        if let Some(ab) = m.unlock_ability {
            if !a.unlocked.contains(&ab) {
                a.unlocked.push(ab);
            }
        }
    }
}

pub fn aggregate_skills(
    ranks: &HashMap<String, u32>,
    base: &[SkillModifier],
) -> SkillAggregate {
    let mut a = SkillAggregate::default();
    for m in base {
        fold_modifier(&mut a, m, 1);
    }
    for (id, r) in ranks {
        if let Some(def) = find_skill(id) {
            let times = (*r).min(def.max_rank);
            fold_modifier(&mut a, &def.modifier, times);
        }
    }
    a.move_speed_mult = a.move_speed_mult.min(MOVE_SPEED_MULT_CAP);
    a
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkillGate {
    Ok,
    Maxed,
    Prereq,
    Points,
}

pub struct LearnResult {
    pub ok: bool,
    pub why: Option<&'static str>,
    pub gate: SkillGate,
    pub reachable: bool,
}

pub fn can_learn(
    id: &str,
    ranks: &HashMap<String, u32>,
    points: u32,
) -> LearnResult {
    let Some(def) = find_skill(id) else {
        return LearnResult {
            ok: false,
            why: Some("unknown skill"),
            gate: SkillGate::Prereq,
            reachable: false,
        };
    };
    let cur = ranks.get(id).copied().unwrap_or(0);
    if cur >= def.max_rank {
        return LearnResult {
            ok: false,
            why: Some("maxed"),
            gate: SkillGate::Maxed,
            reachable: false,
        };
    }
    for req in def.requires {
        if ranks.get(*req).copied().unwrap_or(0) < 1 {
            return LearnResult {
                ok: false,
                why: Some("missing prerequisite"),
                gate: SkillGate::Prereq,
                reachable: false,
            };
        }
    }
    if points < def.cost {
        return LearnResult {
            ok: false,
            why: Some("not enough points"),
            gate: SkillGate::Points,
            reachable: true,
        };
    }
    LearnResult {
        ok: true,
        why: None,
        gate: SkillGate::Ok,
        reachable: true,
    }
}

// ── XP Curve and Level Calculations ──

pub fn xp_for_level(level: u32) -> u32 {
    let l = (level.max(1)) as f64;
    (40.0 * l.powf(1.3)).round() as u32
}

pub const XP_KILL: u32 = 5;
pub const XP_KILL_BOSS: u32 = 60;

pub fn xp_for_floor_clear(floor: u32, grade: &str) -> u32 {
    let bonus = match grade {
        "S" => 40,
        "A" => 25,
        "B" => 10,
        _ => 0,
    };
    25 + floor * 10 + bonus
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct XpState {
    pub xp: u32,
    pub level: u32,
    pub points: u32,
}

pub fn grant_xp(mut cur: XpState, amount: u32) -> (XpState, u32) {
    cur.xp += amount;
    let mut gained = 0;
    while cur.xp >= xp_for_level(cur.level) {
        cur.xp -= xp_for_level(cur.level);
        cur.level += 1;
        cur.points += 1;
        gained += 1;
    }
    (cur, gained)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skill_tree_aggregation_and_clamps() {
        let mut ranks = HashMap::new();
        ranks.insert("whetstone".to_string(), 3);
        ranks.insert("greasedgreaves".to_string(), 3);

        let agg = aggregate_skills(&ranks, &[]);
        assert!((agg.damage_mult - 1.06_f64.powi(3)).abs() < 1e-4);
        assert!((agg.move_speed_mult - 1.04_f64.powi(3)).abs() < 1e-4);
        assert!(agg.move_speed_mult <= MOVE_SPEED_MULT_CAP);
    }

    #[test]
    fn skill_prerequisites_and_learning() {
        let mut ranks = HashMap::new();
        // Cannot learn ironheart without whetstone
        let res = can_learn("ironheart", &ranks, 1);
        assert!(!res.ok);
        assert_eq!(res.gate, SkillGate::Prereq);

        ranks.insert("whetstone".to_string(), 1);
        let res2 = can_learn("ironheart", &ranks, 1);
        assert!(res2.ok);
    }

    #[test]
    fn xp_progression_and_level_ups() {
        let state = XpState {
            xp: 0,
            level: 1,
            points: 0,
        };
        let (next_state, levels) = grant_xp(state, 120);
        assert!(levels > 0);
        assert_eq!(next_state.level, 1 + levels);
        assert_eq!(next_state.points, levels);
    }
}
