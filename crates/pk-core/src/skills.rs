//! SKILLS — the in-run skill tree.
//!
//! Port of `legacy/src/game/pinball-knight/skills.ts` (329 lines).
//!
//! PORTS: `skills.ts`

use std::collections::HashMap;

pub const MOVE_SPEED_MULT_CAP: f64 = 1.5;


#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SkillBranch {
    Steel,
    Flipper,
    Arcana,
}

impl SkillBranch {
    pub fn as_str(&self) -> &'static str {
        match self {
            SkillBranch::Steel => "steel",
            SkillBranch::Flipper => "flipper",
            SkillBranch::Arcana => "arcana",
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct SkillModifier {
    pub damage_mult: Option<f64>,
    pub move_speed_mult: Option<f64>,
    pub max_hp_flat: Option<i32>,
    pub mana_max_flat: Option<i32>,
    pub cooldown_mult: Option<f64>,
    pub gold_mult: Option<f64>,
    pub pinball_damage_mult: Option<f64>,
    pub xp_mult: Option<f64>,
    pub unlock_ability: Option<&'static str>,
    pub momentum_cooldown_rate: Option<f64>,
    pub momentum_ability_power: Option<f64>,
    pub blood_price: bool,
    pub cinder_wake: bool,
    pub dynamo: bool,
}

impl SkillModifier {
    pub const EMPTY: Self = Self {
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
    };
}

#[derive(Debug, Clone, PartialEq)]
pub struct SkillNodeDef {
    pub id: &'static str,
    pub label: &'static str,
    pub icon: &'static str,
    pub description: &'static str,
    pub branch: SkillBranch,
    pub row: usize,
    pub max_rank: usize,
    pub cost: usize,
    pub requires: &'static [&'static str],
    pub modifier: SkillModifier,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SkillAggregate {
    pub damage_mult: f64,
    pub move_speed_mult: f64,
    pub max_hp_flat: i32,
    pub mana_max_flat: i32,
    pub cooldown_mult: f64,
    pub gold_mult: f64,
    pub pinball_damage_mult: f64,
    pub xp_mult: f64,
    pub momentum_cooldown_rate: f64,
    pub momentum_ability_power: f64,
    pub blood_price: bool,
    pub cinder_wake: bool,
    pub dynamo: bool,
    pub unlocked: Vec<&'static str>,
}

impl Default for SkillAggregate {
    fn default() -> Self {
        Self {
            damage_mult: 1.0,
            move_speed_mult: 1.0,
            max_hp_flat: 0,
            mana_max_flat: 0,
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

pub const ALL_SKILL_NODES: &[SkillNodeDef] = &[
    // ── STEEL — melee & survival ──
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
            ..SkillModifier::EMPTY
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
            ..SkillModifier::EMPTY
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
            ..SkillModifier::EMPTY
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
            mana_max_flat: Some(-30),
            ..SkillModifier::EMPTY
        },
    },
    // ── FLIPPER — momentum, mobility, gold ──
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
            ..SkillModifier::EMPTY
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
            ..SkillModifier::EMPTY
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
            ..SkillModifier::EMPTY
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
            ..SkillModifier::EMPTY
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
            ..SkillModifier::EMPTY
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
            ..SkillModifier::EMPTY
        },
    },
    // ── ARCANA — mana, cooldowns, ability unlocks ──
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
            mana_max_flat: Some(15),
            ..SkillModifier::EMPTY
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
            ..SkillModifier::EMPTY
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
            unlock_ability: Some("magnetaura"),
            ..SkillModifier::EMPTY
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
            unlock_ability: Some("timecrawl"),
            ..SkillModifier::EMPTY
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
            unlock_ability: Some("bladestorm"),
            ..SkillModifier::EMPTY
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
            unlock_ability: Some("slickfield"),
            ..SkillModifier::EMPTY
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
            ..SkillModifier::EMPTY
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
            ..SkillModifier::EMPTY
        },
    },
];

pub fn get_skill(id: &str) -> Option<&'static SkillNodeDef> {
    ALL_SKILL_NODES.iter().find(|n| n.id == id)
}

/// Aggregates all learned skill ranks into a single live multiplier set.
pub fn aggregate_skills(
    ranks: &HashMap<String, usize>,
    base: Option<&SkillModifier>,
) -> SkillAggregate {
    let mut agg = SkillAggregate::default();

    if let Some(b) = base {
        if let Some(d) = b.damage_mult {
            agg.damage_mult *= d;
        }
        if let Some(m) = b.move_speed_mult {
            agg.move_speed_mult *= m;
        }
        if let Some(hp) = b.max_hp_flat {
            agg.max_hp_flat += hp;
        }
        if let Some(mana) = b.mana_max_flat {
            agg.mana_max_flat += mana;
        }
        if let Some(cd) = b.cooldown_mult {
            agg.cooldown_mult *= cd;
        }
        if let Some(g) = b.gold_mult {
            agg.gold_mult *= g;
        }
        if let Some(p) = b.pinball_damage_mult {
            agg.pinball_damage_mult *= p;
        }
        if let Some(xp) = b.xp_mult {
            agg.xp_mult *= xp;
        }
    }

    for node in ALL_SKILL_NODES {
        let rank = *ranks.get(node.id).unwrap_or(&0);
        if rank == 0 {
            continue;
        }

        for _ in 0..rank {
            if let Some(d) = node.modifier.damage_mult {
                agg.damage_mult *= d;
            }
            if let Some(m) = node.modifier.move_speed_mult {
                agg.move_speed_mult *= m;
            }
            if let Some(hp) = node.modifier.max_hp_flat {
                agg.max_hp_flat += hp;
            }
            if let Some(mana) = node.modifier.mana_max_flat {
                agg.mana_max_flat += mana;
            }
            if let Some(cd) = node.modifier.cooldown_mult {
                agg.cooldown_mult *= cd;
            }
            if let Some(g) = node.modifier.gold_mult {
                agg.gold_mult *= g;
            }
            if let Some(p) = node.modifier.pinball_damage_mult {
                agg.pinball_damage_mult *= p;
            }
            if let Some(mcr) = node.modifier.momentum_cooldown_rate {
                agg.momentum_cooldown_rate += mcr;
            }
            if let Some(map) = node.modifier.momentum_ability_power {
                agg.momentum_ability_power += map;
            }
        }

        if node.modifier.blood_price {
            agg.blood_price = true;
        }
        if node.modifier.cinder_wake {
            agg.cinder_wake = true;
        }
        if node.modifier.dynamo {
            agg.dynamo = true;
        }
        if let Some(ability) = node.modifier.unlock_ability {
            if !agg.unlocked.contains(&ability) {
                agg.unlocked.push(ability);
            }
        }
    }

    agg.move_speed_mult = agg.move_speed_mult.min(MOVE_SPEED_MULT_CAP);
    agg
}

pub fn can_learn(id: &str, ranks: &HashMap<String, usize>, points: usize) -> bool {
    let node = match get_skill(id) {
        Some(n) => n,
        None => return false,
    };
    let current_rank = *ranks.get(id).unwrap_or(&0);
    if current_rank >= node.max_rank {
        return false;
    }
    if points < node.cost {
        return false;
    }
    for req in node.requires {
        if *ranks.get(*req).unwrap_or(&0) < 1 {
            return false;
        }
    }
    true
}

#[derive(Debug, Clone, PartialEq)]
pub struct XpState {
    pub xp: f64,
    pub level: usize,
    pub points: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct XpGainResult {
    pub xp: f64,
    pub level: usize,
    pub points: usize,
    pub levels_gained: usize,
}

pub const XP_KILL: f64 = 5.0;
pub const XP_KILL_BOSS: f64 = 60.0;

pub fn xp_for_level(level: usize) -> f64 {
    (40.0 * ((level.max(1) as f64).powf(1.3))).round()
}

pub fn grant_xp(current: &XpState, amount: f64) -> XpGainResult {
    let mut xp = current.xp + amount.max(0.0).round();
    let mut level = current.level;
    let mut points = current.points;
    let mut levels_gained = 0;

    while xp >= xp_for_level(level) {
        xp -= xp_for_level(level);
        level += 1;
        points += 1;
        levels_gained += 1;
    }

    XpGainResult {
        xp,
        level,
        points,
        levels_gained,
    }
}

pub fn xp_for_floor_clear(floor: u32, grade: &str) -> f64 {
    let grade_bonus = match grade {
        "S" => 40.0,
        "A" => 25.0,
        "B" => 10.0,
        _ => 0.0,
    };
    25.0 + (floor as f64) * 10.0 + grade_bonus
}
